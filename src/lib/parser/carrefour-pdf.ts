import path from "node:path";
import { createHash } from "node:crypto";
import {
  buildNormalizedLabel,
  extractPackageMetrics,
  maskLoyaltyCards,
} from "./normalize";

export interface ParsedReceiptItem {
  lineIndex: number;
  rawLabel: string;
  normalizedLabel: string;
  vatRate: number | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  immediateDiscount: number;
  loyaltyDiscount: number;
  netTotalPrice: number;
  netUnitPrice: number;
  weightKg: number | null;
  volumeL: number | null;
  pricePerKgOrL: number | null;
  netPricePerKgOrL: number | null;
  unitType: "kg" | "L" | "piece";
}

export interface ParsedReceipt {
  externalId: string;
  ticketKey: string;
  storeName: string;
  storeCode: string | null;
  purchaseDate: Date;
  totalBeforeDiscount: number;
  totalImmediateDiscount: number;
  totalPaid: number;
  loyaltyCredited: number;
  paymentMethod: string | null;
  barcode: string | null;
  fileName: string | null;
  rawText: string;
  items: ParsedReceiptItem[];
}

interface TextItemPos {
  str: string;
  x: number;
  y: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function parseNumber(value: string): number {
  return Number(value.replace(",", ".").replace(/\s/g, ""));
}

/**
 * Extract visual lines from a PDF buffer using pdfjs-dist with (x, y) grouping.
 */
async function extractLinesFromPdf(buffer: Buffer): Promise<string[]> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerPath = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs"
  );
  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `file:///${workerPath.replace(/\\/g, "/")}`;
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  });

  const pdf = await loadingTask.promise;
  const allLines: string[] = [];

  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const rawItems: TextItemPos[] = [];

      for (const item of textContent.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const transform = item.transform;
        rawItems.push({
          str: item.str.trim(),
          x: transform[4],
          y: transform[5],
        });
      }

      // Sort top-to-bottom (y descending), then left-to-right (x ascending)
      rawItems.sort((a, b) => {
        if (Math.abs(a.y - b.y) > 2.8) return b.y - a.y;
        return a.x - b.x;
      });

      const lineGroups: Array<{ y: number; items: TextItemPos[] }> = [];
      for (const item of rawItems) {
        const existing = lineGroups.find((g) => Math.abs(g.y - item.y) <= 2.8);
        if (existing) {
          existing.items.push(item);
        } else {
          lineGroups.push({ y: item.y, items: [item] });
        }
      }

      for (const group of lineGroups) {
        group.items.sort((a, b) => a.x - b.x);
        const lineText = group.items
          .map((i) => i.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (lineText) {
          allLines.push(lineText);
        }
      }
    }
  } finally {
    if (typeof pdf.cleanup === "function") {
      await pdf.cleanup();
    }
    await loadingTask.destroy();
  }

  return allLines;
}

/**
 * Parse a Carrefour digital receipt PDF buffer into structured receipt + item records.
 */
export async function parseCarrefourReceiptPdf(
  buffer: Buffer,
  fileName?: string
): Promise<ParsedReceipt> {
  const rawLines = await extractLinesFromPdf(buffer);
  const maskedLines = rawLines.map((line) => maskLoyaltyCards(line));
  const rawText = maskedLines.join("\n");

  // 1. Store Name (line immediately preceding "Tél:")
  let storeName = "Carrefour";
  const telIndex = maskedLines.findIndex((l) => /^T[ée]l\s*:/i.test(l));
  if (telIndex > 0) {
    storeName = maskedLines[telIndex - 1].trim();
  } else {
    const storeFallback = maskedLines.find((l) =>
      /^(MARKET|CITY|HYPER|EXPRESS|CARREFOUR)\b/i.test(l)
    );
    if (storeFallback) storeName = storeFallback.trim();
  }

  // 2. Date & Time ("13/11/2026 à 20h01")
  let purchaseDate: Date | null = null;
  for (const line of maskedLines) {
    const m = line.match(/(\d{2})\/(\d{2})\/(\d{4})\s+[àa]\s+(\d{2})h(\d{2})/i);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const year = Number(m[3]);
      const hour = Number(m[4]);
      const minute = Number(m[5]);
      purchaseDate = new Date(year, month - 1, day, hour, minute, 0, 0);
      break;
    }
  }

  // 3. Footer signature ("01.11.26 11:57 7837 3 8993 0108")
  let storeCode: string | null = null;
  let ticketKey = "";
  let externalId = "";

  for (const line of maskedLines) {
    const footerMatch = line.match(
      /(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/
    );
    if (footerMatch) {
      const dd = footerMatch[1];
      const mm = footerMatch[2];
      const yy = footerMatch[3];
      const hh = footerMatch[4];
      const min = footerMatch[5];
      storeCode = footerMatch[6];
      const register = footerMatch[7];
      const ticketNumber = footerMatch[8];

      if (!purchaseDate) {
        purchaseDate = new Date(
          2000 + Number(yy),
          Number(mm) - 1,
          Number(dd),
          Number(hh),
          Number(min),
          0,
          0
        );
      }

      ticketKey = `${register}-${ticketNumber}-${hh}${min}`;
      externalId = `20${yy}${mm}${dd}-${storeCode}-${ticketKey}`;
      break;
    }
  }

  if (!purchaseDate) {
    purchaseDate = new Date();
  }

  if (!ticketKey && fileName) {
    const fnMatch = fileName.match(/(\d+-\d+-\d+)/);
    if (fnMatch) ticketKey = fnMatch[1];
  }

  if (!externalId) {
    const hash = createHash("sha256").update(rawText).digest("hex").slice(0, 12);
    const yyyy = purchaseDate.getFullYear();
    const mm = String(purchaseDate.getMonth() + 1).padStart(2, "0");
    const dd = String(purchaseDate.getDate()).padStart(2, "0");
    ticketKey = ticketKey || hash;
    externalId = `${yyyy}${mm}${dd}-${storeCode ?? "0000"}-${ticketKey}`;
  }

  // 4. Barcode (long numeric line near bottom, 20-35 digits)
  let barcode: string | null = null;
  for (const line of maskedLines) {
    if (/^\d{20,36}$/.test(line.trim())) {
      barcode = line.trim();
      break;
    }
  }

  // 5. Parse items section
  const itemsHeaderIdx = maskedLines.findIndex((l) =>
    /TVA\s+Produit\s+QTE/i.test(l)
  );
  const itemsStartIdx = itemsHeaderIdx >= 0 ? itemsHeaderIdx + 1 : 0;

  const items: ParsedReceiptItem[] = [];
  let totalBeforeDiscount: number | null = null;
  let totalImmediateDiscount = 0;
  let totalPaid: number | null = null;
  let loyaltyCredited = 0;
  const paymentMethods: string[] = [];

  let inItemsSection = true;
  let inPaymentSection = false;
  let inLoyaltyDetails = false;
  const loyaltyBreakdown: Array<{ label: string; amount: number }> = [];

  for (let i = itemsStartIdx; i < maskedLines.length; i++) {
    const line = maskedLines[i];

    // Totals markers end the items section
    const totalBeforeMatch = line.match(
      /^Total avant remises\s+(-?\d+(?:[.,]\d+)?)\s*€?/i
    );
    if (totalBeforeMatch) {
      inItemsSection = false;
      totalBeforeDiscount = parseNumber(totalBeforeMatch[1]);
      continue;
    }

    const totalImmediateMatch = line.match(
      /^Total Remises imm[ée]diates\s+(-?\d+(?:[.,]\d+)?)\s*€?/i
    );
    if (totalImmediateMatch) {
      inItemsSection = false;
      totalImmediateDiscount = Math.abs(parseNumber(totalImmediateMatch[1]));
      continue;
    }

    const totalPaidMatch = line.match(
      /^Total [àa] payer\s+(-?\d+(?:[.,]\d+)?)\s*€?/i
    );
    if (totalPaidMatch) {
      inItemsSection = false;
      totalPaid = parseNumber(totalPaidMatch[1]);
      continue;
    }

    if (/^Pay[ée]\s+par$/i.test(line)) {
      inItemsSection = false;
      inPaymentSection = true;
      inLoyaltyDetails = false;
      continue;
    }

    if (/^Ma carte Club Carrefour/i.test(line)) {
      inPaymentSection = false;
      continue;
    }

    const loyaltyCreditedMatch = line.match(
      /(\d+(?:[.,]\d+)?)\s*€\s+cr[ée]dit[ée]s sur votre compte/i
    );
    if (loyaltyCreditedMatch) {
      loyaltyCredited = parseNumber(loyaltyCreditedMatch[1]);
      continue;
    }

    if (/^AVANTAGES\b/i.test(line)) {
      inLoyaltyDetails = true;
      inPaymentSection = false;
      continue;
    }

    if (inPaymentSection) {
      if (
        /^\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}/.test(line) ||
        /^\d{20,36}$/.test(line)
      ) {
        inPaymentSection = false;
      } else {
        const cleanPay = line
          .replace(/\.{2,}/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (cleanPay) paymentMethods.push(cleanPay);
        continue;
      }
    }

    if (inLoyaltyDetails) {
      if (
        /^\d{20,36}$/.test(line) ||
        /^\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}/.test(line)
      ) {
        inLoyaltyDetails = false;
      } else {
        const loyMatch = line.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*€$/);
        if (loyMatch) {
          loyaltyBreakdown.push({
            label: loyMatch[1].trim(),
            amount: parseNumber(loyMatch[2]),
          });
        }
        continue;
      }
    }

    if (!inItemsSection) continue;

    // Weight sub-line: "0.886kg x 2.89€/kg"
    const weightMatch = line.match(
      /(\d+(?:[.,]\d+)?)\s*kg\s*x\s*(\d+(?:[.,]\d+)?)\s*€\/kg/i
    );
    if (weightMatch) {
      const weightKg = parseNumber(weightMatch[1]);
      const pricePerKg = parseNumber(weightMatch[2]);
      const lastItem = items[items.length - 1];
      if (
        lastItem &&
        lastItem.weightKg === null &&
        Math.abs(weightKg * pricePerKg - lastItem.totalPrice) <= 0.05
      ) {
        lastItem.weightKg = round3(weightKg);
        lastItem.pricePerKgOrL = round2(pricePerKg);
        lastItem.unitType = "kg";
      } else {
        // Fallback match against any item without weight whose total matches weight * pricePerKg
        const candidate = items.find(
          (it) =>
            it.weightKg === null &&
            Math.abs(weightKg * pricePerKg - it.totalPrice) <= 0.05
        );
        if (candidate) {
          candidate.weightKg = round3(weightKg);
          candidate.pricePerKgOrL = round2(pricePerKg);
          candidate.unitType = "kg";
        }
      }
      continue;
    }

    // Immediate discount sub-line: "Remise immédiate -1.48"
    const discountMatch = line.match(
      /Remise\s+imm[ée]diate\s+(-?\d+(?:[.,]\d+)?)/i
    );
    if (discountMatch) {
      const discount = Math.abs(parseNumber(discountMatch[1]));
      const lastItem = items[items.length - 1];
      if (lastItem) {
        lastItem.immediateDiscount = round2(
          lastItem.immediateDiscount + discount
        );
      }
      continue;
    }

    // Standard item line: "5.5% FLT 1.5KG ORAN JUS 1 x 3.99 3.99"
    const itemMatch = line.match(
      /^(\d+(?:[.,]\d+)?)%\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)$/i
    );
    if (itemMatch) {
      const vatRate = parseNumber(itemMatch[1]);
      const rawLabel = itemMatch[2].trim();
      const quantity = parseNumber(itemMatch[3]);
      const unitPrice = parseNumber(itemMatch[4]);
      const totalPrice = parseNumber(itemMatch[5]);

      items.push({
        lineIndex: items.length,
        rawLabel,
        normalizedLabel: buildNormalizedLabel(rawLabel),
        vatRate,
        quantity,
        unitPrice: round2(unitPrice),
        totalPrice: round2(totalPrice),
        immediateDiscount: 0,
        loyaltyDiscount: 0,
        netTotalPrice: round2(totalPrice),
        netUnitPrice: round2(quantity > 0 ? totalPrice / quantity : unitPrice),
        weightKg: null,
        volumeL: null,
        pricePerKgOrL: null,
        netPricePerKgOrL: null,
        unitType: "piece",
      });
    }
  }

  // 6. Distribute loyalty advantages across matching items
  for (const loy of loyaltyBreakdown) {
    const matching = items.filter(
      (it) => it.rawLabel.toUpperCase() === loy.label.toUpperCase()
    );
    if (matching.length === 0) continue;

    if (matching.length === 1) {
      matching[0].loyaltyDiscount = round2(
        matching[0].loyaltyDiscount + loy.amount
      );
      continue;
    }

    const totalMatchPrice = matching.reduce((acc, it) => acc + it.totalPrice, 0);
    let distributed = 0;
    for (let idx = 0; idx < matching.length; idx++) {
      const it = matching[idx];
      if (idx === matching.length - 1) {
        const remainder = round2(loy.amount - distributed);
        it.loyaltyDiscount = round2(it.loyaltyDiscount + remainder);
      } else {
        const share =
          totalMatchPrice > 0
            ? Math.floor((loy.amount * (it.totalPrice / totalMatchPrice)) * 100) /
              100
            : Math.floor((loy.amount / matching.length) * 100) / 100;
        it.loyaltyDiscount = round2(it.loyaltyDiscount + share);
        distributed = round2(distributed + share);
      }
    }
  }

  // 7. Compute net prices & package weights/volumes
  for (const item of items) {
    item.netTotalPrice = round2(
      Math.max(0, item.totalPrice - item.immediateDiscount - item.loyaltyDiscount)
    );
    item.netUnitPrice = round2(
      item.quantity > 0 ? item.netTotalPrice / item.quantity : item.netTotalPrice
    );

    if (item.weightKg === null && item.volumeL === null) {
      const pkg = extractPackageMetrics(item.rawLabel, item.quantity);
      if (pkg.weightKg !== null) {
        item.weightKg = round3(pkg.weightKg);
        item.unitType = "kg";
        item.pricePerKgOrL = round2(item.totalPrice / item.weightKg);
      } else if (pkg.volumeL !== null) {
        item.volumeL = round3(pkg.volumeL);
        item.unitType = "L";
        item.pricePerKgOrL = round2(item.totalPrice / item.volumeL);
      }
    }

    const metricAmount = item.weightKg ?? item.volumeL;
    if (metricAmount && metricAmount > 0) {
      item.netPricePerKgOrL = round2(item.netTotalPrice / metricAmount);
    }
  }

  // 8. Reconcile totals
  const itemsSum = round2(items.reduce((acc, it) => acc + it.totalPrice, 0));
  const itemsDiscountSum = round2(
    items.reduce((acc, it) => acc + it.immediateDiscount, 0)
  );

  if (totalImmediateDiscount === 0 && itemsDiscountSum > 0) {
    totalImmediateDiscount = itemsDiscountSum;
  }

  const finalTotalBeforeDiscount =
    totalBeforeDiscount !== null
      ? round2(totalBeforeDiscount)
      : itemsSum > 0
      ? itemsSum
      : round2((totalPaid ?? 0) + totalImmediateDiscount);

  const finalTotalPaid =
    totalPaid !== null
      ? round2(totalPaid)
      : round2(finalTotalBeforeDiscount - totalImmediateDiscount);

  if (items.length === 0) {
    throw new Error(
      `Aucun article détecté dans le ticket${fileName ? ` (${fileName})` : ""}. Vérifiez qu'il s'agit bien d'un ticket Carrefour numérique.`
    );
  }

  return {
    externalId,
    ticketKey,
    storeName,
    storeCode,
    purchaseDate,
    totalBeforeDiscount: finalTotalBeforeDiscount,
    totalImmediateDiscount: round2(totalImmediateDiscount),
    totalPaid: finalTotalPaid,
    loyaltyCredited: round2(loyaltyCredited),
    paymentMethod: paymentMethods.length > 0 ? paymentMethods.join(" · ") : null,
    barcode,
    fileName: fileName ?? null,
    rawText,
    items,
  };
}
