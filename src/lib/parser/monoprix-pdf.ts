import { createHash } from "node:crypto";
import type { ParsedReceipt, ParsedReceiptItem } from "./carrefour-pdf";
import {
  buildNormalizedLabel,
  extractPackageMetrics,
  maskPersonalInfo,
} from "./normalize";
import {
  extractPdfDocument,
  type ExtractedPdfDocument,
  type PdfPageData,
  type PdfTextItem,
} from "./pdf-text";

interface NumericAnchorRow {
  y: number;
  priceHT: number;
  priceHTX: number;
  priceTTC: number;
  priceTTCX: number;
  priceDiscounted: number;
  qty: number;
  totalTTC: number;
  vatRate: number | null;
  labelFragments: PdfTextItem[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function parseFrNumber(value: string): number {
  return Number(value.replace(",", ".").replace(/\s/g, ""));
}

const IGNORED_HEADER_FOOTER_RE =
  /^(?:Libell[ée]\s+produit|Prix\s+Unit|TVA%|Qt[ée]\s+livr[ée]e|Prix\s+Total|Certifications|Nom\s+du\s+client|N°\s*de\s*facture|Votre\s+e-?mail|Date\s+de\s+la|Adresse\s+de\s+livraison|R[ée]capitulatif\s+cagnotte|Utilisation\s+cagnotte|Cagnott[ée]\s*:|Monoprix\s+Exploitation|RCS\s+Nanterre|TVA\s+intracommunautaire|MONOPRIX\.fr|Courses|Nombre\s+total|Nombre\s+de\s+produits|Total\s+des\s+marchandises|Total\s+remises|Frais\s+de|Consigne\s+de|Retour|Total\s+de\s+la\s+commande)/i;

function mergeAdjacentEuroTokens(items: PdfTextItem[]): PdfTextItem[] {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const merged: PdfTextItem[] = [];
  for (const item of sorted) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      item.str === "€" &&
      /\d+(?:[.,]\d{2})$/.test(prev.str) &&
      item.x - (prev.x + prev.width) < 16
    ) {
      prev.str = `${prev.str} €`;
      prev.width = item.x + item.width - prev.x;
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

function extractPageTableRows(page: PdfPageData): Array<{
  rawLabel: string;
  vatRate: number | null;
  priceTTC: number;
  priceDiscounted: number;
  qty: number;
  totalTTC: number;
}> {
  // Group items into visual rows to locate numeric anchor lines
  const sorted = [...page.items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 3.5) return b.y - a.y;
    return a.x - b.x;
  });

  const rows: Array<{ y: number; items: PdfTextItem[] }> = [];
  for (const item of sorted) {
    const existing = rows.find((r) => Math.abs(r.y - item.y) <= 3.5);
    if (existing) {
      existing.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  const anchors: NumericAnchorRow[] = [];
  for (const row of rows) {
    const tokens = mergeAdjacentEuroTokens(row.items);
    const euroTokens = tokens
      .map((t) => ({
        item: t,
        match: t.str.match(/^(\d+(?:[.,]\d{2}))\s*€$/),
      }))
      .filter(
        (x): x is { item: PdfTextItem; match: RegExpMatchArray } =>
          x.match !== null
      );

    if (euroTokens.length < 4) continue;

    // Take the rightmost 4 euro columns: HT, TTC, Remisé, Total TTC
    const cols = euroTokens.slice(-4);
    const ht = cols[0];
    const ttc = cols[1];
    const rem = cols[2];
    const tot = cols[3];

    const qtyToken = tokens.find(
      (t) =>
        t.x > rem.item.x &&
        t.x < tot.item.x &&
        /^\d+$/.test(t.str.trim())
    );
    if (!qtyToken) continue;

    const inlineVat = tokens.find(
      (t) =>
        t.x > ht.item.x &&
        t.x < ttc.item.x &&
        /^(\d+(?:[.,]\d+)?)\s*%?$/.test(t.str.trim())
    );
    const vatMatch = inlineVat?.str.trim().match(/^(\d+(?:[.,]\d+)?)\s*%?$/);

    anchors.push({
      y: row.y,
      priceHT: parseFrNumber(ht.match[1]),
      priceHTX: ht.item.x,
      priceTTC: parseFrNumber(ttc.match[1]),
      priceTTCX: ttc.item.x,
      priceDiscounted: parseFrNumber(rem.match[1]),
      qty: Number(qtyToken.str.trim()),
      totalTTC: parseFrNumber(tot.match[1]),
      vatRate: vatMatch ? parseFrNumber(vatMatch[1]) : null,
      labelFragments: [],
    });
  }

  if (anchors.length === 0) {
    return [];
  }

  const labelMaxX = Math.min(...anchors.map((a) => a.priceHTX)) - 6;

  // Determine vertical boundaries of the table on this page
  const headerItem = page.items.find((it) =>
    /^Libell[ée]\s+produit/i.test(it.str)
  );
  const tableTopY = headerItem ? headerItem.y - 6 : anchors[0].y + 24;

  const footerItems = page.items.filter((it) =>
    /^(?:Nombre\s+total|Nombre\s+de\s+produits|Total\s+des\s+marchandises)/i.test(
      it.str
    )
  );
  const tableBottomY =
    footerItems.length > 0
      ? Math.max(...footerItems.map((f) => f.y)) + 6
      : anchors[anchors.length - 1].y - 30;

  // Assign label fragments and wrapped VAT numbers to their nearest anchor row
  for (const item of page.items) {
    if (item.y > tableTopY || item.y < tableBottomY) continue;

    if (item.x < labelMaxX) {
      if (IGNORED_HEADER_FOOTER_RE.test(item.str.trim())) continue;
      let bestAnchor: NumericAnchorRow | null = null;
      let bestDist = Infinity;
      for (const anchor of anchors) {
        const dist = Math.abs(item.y - anchor.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestAnchor = anchor;
        }
      }
      if (bestAnchor && bestDist <= 36) {
        bestAnchor.labelFragments.push(item);
      }
      continue;
    }

    // Check wrapped VAT number between HT and TTC columns
    const vatTokenMatch = item.str.trim().match(/^(\d+(?:[.,]\d+)?)$/);
    if (vatTokenMatch) {
      let bestAnchor: NumericAnchorRow | null = null;
      let bestDist = Infinity;
      for (const anchor of anchors) {
        if (item.x > anchor.priceHTX && item.x < anchor.priceTTCX) {
          const dist = Math.abs(item.y - anchor.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestAnchor = anchor;
          }
        }
      }
      if (bestAnchor && bestAnchor.vatRate === null && bestDist <= 18) {
        bestAnchor.vatRate = parseFrNumber(vatTokenMatch[1]);
      }
    }
  }

  return anchors
    .map((anchor) => {
      const sortedFrags = [...anchor.labelFragments].sort((a, b) => {
        if (Math.abs(a.y - b.y) > 2.8) return b.y - a.y;
        return a.x - b.x;
      });
      const rawLabel = sortedFrags
        .map((f) => f.str.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        rawLabel,
        vatRate: anchor.vatRate,
        priceTTC: anchor.priceTTC,
        priceDiscounted: anchor.priceDiscounted,
        qty: anchor.qty,
        totalTTC: anchor.totalTTC,
      };
    })
    .filter((row) => row.rawLabel.length > 0 && row.qty > 0);
}

/**
 * Parse a Monoprix Courses invoice from an already-extracted PDF document.
 */
export function parseMonoprixFromDocument(
  doc: ExtractedPdfDocument,
  fileName?: string
): ParsedReceipt {
  const rawText = maskPersonalInfo(doc.allLines.join("\n"));

  // 1. Invoice number
  let ticketKey = "";
  for (const line of doc.allLines) {
    const m = line.match(/N°\s*de\s*facture\s*:\s*(\d+)/i);
    if (m) {
      ticketKey = m[1];
      break;
    }
  }

  // 2. Order date ("Date de la commande : samedi, 14/11/2026 11:47")
  let purchaseDate: Date | null = null;
  for (const line of doc.allLines) {
    const cmdMatch = line.match(
      /Date\s+de\s+la\s+commande\s*:.*?(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/i
    );
    if (cmdMatch) {
      purchaseDate = new Date(
        Number(cmdMatch[3]),
        Number(cmdMatch[2]) - 1,
        Number(cmdMatch[1]),
        Number(cmdMatch[4]),
        Number(cmdMatch[5]),
        0,
        0
      );
      break;
    }
  }
  if (!purchaseDate) {
    for (const line of doc.allLines) {
      const livMatch = line.match(
        /Date\s+de\s+la\s+livraison\s*:.*?(\d{2})\/(\d{2})\/(\d{4})/i
      );
      if (livMatch) {
        purchaseDate = new Date(
          Number(livMatch[3]),
          Number(livMatch[2]) - 1,
          Number(livMatch[1]),
          12,
          0,
          0,
          0
        );
        break;
      }
    }
  }
  if (!purchaseDate) {
    purchaseDate = new Date();
  }

  if (!ticketKey) {
    ticketKey = createHash("sha256").update(rawText).digest("hex").slice(0, 12);
  }
  const externalId = `monoprix-${ticketKey}`;

  // 3. Extract item rows from all pages
  const extractedRows = doc.pages.flatMap((page) => extractPageTableRows(page));

  // 4. Parse summary totals, M+ discount, loyalty, and fees
  let totalGoodsTTC: number | null = null;
  let totalImmediateDiscount: number | null = null;
  let globalDiscount = 0;
  let loyaltyCredited = 0;
  let prepFee = 0;
  let deliveryFee = 0;
  let bagDeposit = 0;
  let bagReturn = 0;
  let totalPaid: number | null = null;
  let inReturnSection = false;

  for (const line of doc.allLines) {
    const goodsTTCMatch = line.match(
      /Total\s+des\s+marchandises(?!\s+HT)\b.*?(\d+(?:[.,]\d{2}))\s*€?/i
    );
    if (goodsTTCMatch) {
      totalGoodsTTC = parseFrNumber(goodsTTCMatch[1]);
      continue;
    }

    const remisesMatch = line.match(
      /Total\s+remises\s+marchandises\s+(-?\d+(?:[.,]\d{2}))\s*€?/i
    );
    if (remisesMatch) {
      totalImmediateDiscount = Math.abs(parseFrNumber(remisesMatch[1]));
      continue;
    }

    const mPlusMatch = line.match(
      /(?:\d+\s*%\s*)?remise\s*M\+\s+(-?\d+(?:[.,]\d{2}))\s*€?/i
    );
    if (mPlusMatch) {
      globalDiscount = Math.abs(parseFrNumber(mPlusMatch[1]));
      inReturnSection = false;
      continue;
    }

    const cagnotteMatch = line.match(
      /^Cagnott[ée]\s*:\s*(\d+(?:[.,]\d{2}))\s*€?/i
    );
    if (cagnotteMatch) {
      loyaltyCredited = parseFrNumber(cagnotteMatch[1]);
      continue;
    }

    const prepMatch = line.match(
      /Frais\s+de\s+pr[ée]paration\s+(\d+(?:[.,]\d{2}))\s*€?/i
    );
    if (prepMatch) {
      prepFee = parseFrNumber(prepMatch[1]);
      continue;
    }

    const delivMatch = line.match(
      /Frais\s+de\s+livraison\s+(\d+(?:[.,]\d{2}))\s*€?/i
    );
    if (delivMatch) {
      deliveryFee = parseFrNumber(delivMatch[1]);
      continue;
    }

    const consigneMatch = line.match(
      /Consigne\s+de\s+sacs\s+de\s+courses\s+(\d+(?:[.,]\d{2}))\s*€?/i
    );
    if (consigneMatch) {
      bagDeposit = parseFrNumber(consigneMatch[1]);
      continue;
    }

    if (/^Retour$/i.test(line.trim())) {
      inReturnSection = true;
      continue;
    }

    if (inReturnSection) {
      const sacsMatch = line.match(
        /^\d+\s+sacs?\s+(\d+(?:[.,]\d{2}))\s*€?/i
      );
      if (sacsMatch) {
        bagReturn = parseFrNumber(sacsMatch[1]);
        inReturnSection = false;
        continue;
      }
    }

    const totalOrderMatch = line.match(
      /Total\s+de\s+la\s+commande\s+(\d+(?:[.,]\d{2}))\s*€?/i
    );
    if (totalOrderMatch) {
      totalPaid = parseFrNumber(totalOrderMatch[1]);
      inReturnSection = false;
      continue;
    }
  }

  if (extractedRows.length === 0) {
    throw new Error(
      `Aucun article détecté dans la facture Monoprix${fileName ? ` (${fileName})` : ""}.`
    );
  }

  // 5. Build items and prorate M+ global discount proportionally to lineTotalTTC
  const items: ParsedReceiptItem[] = extractedRows.map((row, index) => {
    const grossTotal = round2(row.priceTTC * row.qty);
    const immediateDiscount = round2(Math.max(0, grossTotal - row.totalTTC));

    return {
      lineIndex: index,
      rawLabel: row.rawLabel,
      normalizedLabel: buildNormalizedLabel(row.rawLabel),
      vatRate: row.vatRate,
      quantity: row.qty,
      unitPrice: round2(row.priceTTC),
      totalPrice: grossTotal,
      immediateDiscount,
      loyaltyDiscount: 0,
      netTotalPrice: round2(row.totalTTC),
      netUnitPrice: round2(row.totalTTC / row.qty),
      weightKg: null,
      volumeL: null,
      pricePerKgOrL: null,
      netPricePerKgOrL: null,
      unitType: "piece",
    };
  });

  const paidGoodsSum = round2(
    extractedRows.reduce((acc, row) => acc + row.totalTTC, 0)
  );

  if (globalDiscount > 0 && paidGoodsSum > 0) {
    // Largest-remainder distribution in integer cents so sum(loyaltyDiscount) === globalDiscount
    const totalCents = Math.round(globalDiscount * 100);
    const allocations = extractedRows.map((row, idx) => {
      const exact = (totalCents * row.totalTTC) / paidGoodsSum;
      const floor = Math.floor(exact);
      return { idx, floor, frac: exact - floor };
    });
    const allocatedSum = allocations.reduce((s, a) => s + a.floor, 0);
    let remainderCents = totalCents - allocatedSum;
    const byFrac = [...allocations].sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < byFrac.length && remainderCents > 0; i++) {
      byFrac[i].floor += 1;
      remainderCents -= 1;
    }
    for (const alloc of allocations) {
      items[alloc.idx].loyaltyDiscount = round2(alloc.floor / 100);
    }
  }

  // 6. Compute net prices & package metrics
  for (const item of items) {
    item.netTotalPrice = round2(
      Math.max(0, item.totalPrice - item.immediateDiscount - item.loyaltyDiscount)
    );
    item.netUnitPrice = round2(
      item.quantity > 0 ? item.netTotalPrice / item.quantity : item.netTotalPrice
    );

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

    const metricAmount = item.weightKg ?? item.volumeL;
    if (metricAmount && metricAmount > 0) {
      item.netPricePerKgOrL = round2(item.netTotalPrice / metricAmount);
    }
  }

  const grossSum = round2(items.reduce((s, it) => s + it.totalPrice, 0));
  const itemDiscountSum = round2(
    items.reduce((s, it) => s + it.immediateDiscount, 0)
  );

  const finalTotalBeforeDiscount =
    totalGoodsTTC !== null ? round2(totalGoodsTTC) : grossSum;
  const finalImmediateDiscount =
    totalImmediateDiscount !== null
      ? round2(totalImmediateDiscount)
      : itemDiscountSum;
  const extraFees = round2(prepFee + deliveryFee + bagDeposit - bagReturn);
  const finalTotalPaid =
    totalPaid !== null
      ? round2(totalPaid)
      : round2(
          finalTotalBeforeDiscount -
            finalImmediateDiscount -
            globalDiscount +
            extraFees
        );

  return {
    retailer: "monoprix",
    externalId,
    ticketKey,
    storeName: "MONOPRIX.fr Courses",
    storeCode: null,
    purchaseDate,
    totalBeforeDiscount: finalTotalBeforeDiscount,
    totalImmediateDiscount: finalImmediateDiscount,
    globalDiscount: round2(globalDiscount),
    extraFees,
    totalPaid: finalTotalPaid,
    loyaltyCredited: round2(loyaltyCredited),
    paymentMethod: "Commande en ligne Monoprix.fr",
    barcode: null,
    fileName: fileName ?? null,
    rawText,
    items,
  };
}

/**
 * Parse a Monoprix Courses PDF invoice buffer into structured receipt + item records.
 */
export async function parseMonoprixReceiptPdf(
  buffer: Buffer,
  fileName?: string
): Promise<ParsedReceipt> {
  const doc = await extractPdfDocument(buffer);
  return parseMonoprixFromDocument(doc, fileName);
}
