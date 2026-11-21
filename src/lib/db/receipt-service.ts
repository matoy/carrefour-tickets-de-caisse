import fs from "node:fs";
import path from "node:path";
import { desc, eq, inArray } from "drizzle-orm";
import { ensureDbInitialized } from "./index";
import {
  receipts,
  receiptItems,
  productNotes,
  syncSettings,
} from "./schema";
import {
  parseReceiptPdf,
  type ParsedReceipt,
  type Retailer,
} from "../parser";
import { stripAccents } from "../parser/normalize";

export interface UpsertResult {
  inserted: boolean;
  skipped: boolean;
  retailer: Retailer;
  externalId: string;
  ticketKey: string;
  storeName: string;
  totalPaid: number;
  itemCount: number;
  receiptId: number | null;
}

/**
 * Insert a parsed receipt (Carrefour or Monoprix) and all its line items if externalId is not already in DB.
 */
export async function insertParsedReceiptIfNew(
  parsed: ParsedReceipt,
  source: "pdf_upload" | "local_seed"
): Promise<UpsertResult> {
  const db = await ensureDbInitialized();

  const existing = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(eq(receipts.externalId, parsed.externalId))
    .limit(1);

  if (existing.length > 0) {
    return {
      inserted: false,
      skipped: true,
      retailer: parsed.retailer,
      externalId: parsed.externalId,
      ticketKey: parsed.ticketKey,
      storeName: parsed.storeName,
      totalPaid: parsed.totalPaid,
      itemCount: parsed.items.length,
      receiptId: existing[0].id,
    };
  }

  const insertedRows = await db
    .insert(receipts)
    .values({
      externalId: parsed.externalId,
      retailer: parsed.retailer,
      ticketKey: parsed.ticketKey,
      storeName: parsed.storeName,
      storeCode: parsed.storeCode,
      purchaseDate: parsed.purchaseDate,
      totalBeforeDiscount: parsed.totalBeforeDiscount.toFixed(2),
      totalImmediateDiscount: parsed.totalImmediateDiscount.toFixed(2),
      globalDiscount: parsed.globalDiscount.toFixed(2),
      extraFees: parsed.extraFees.toFixed(2),
      totalPaid: parsed.totalPaid.toFixed(2),
      loyaltyCredited: parsed.loyaltyCredited.toFixed(2),
      paymentMethod: parsed.paymentMethod,
      barcode: parsed.barcode,
      source,
      fileName: parsed.fileName,
      rawText: parsed.rawText,
    })
    .onConflictDoNothing({ target: receipts.externalId })
    .returning({ id: receipts.id });

  if (insertedRows.length === 0) {
    return {
      inserted: false,
      skipped: true,
      retailer: parsed.retailer,
      externalId: parsed.externalId,
      ticketKey: parsed.ticketKey,
      storeName: parsed.storeName,
      totalPaid: parsed.totalPaid,
      itemCount: parsed.items.length,
      receiptId: null,
    };
  }

  const receiptId = insertedRows[0].id;

  try {
    if (parsed.items.length > 0) {
      await db.insert(receiptItems).values(
        parsed.items.map((item) => ({
          receiptId,
          lineIndex: item.lineIndex,
          rawLabel: item.rawLabel,
          normalizedLabel: item.normalizedLabel,
          vatRate: item.vatRate !== null ? item.vatRate.toFixed(2) : null,
          quantity: item.quantity.toFixed(3),
          unitPrice: item.unitPrice.toFixed(2),
          totalPrice: item.totalPrice.toFixed(2),
          immediateDiscount: item.immediateDiscount.toFixed(2),
          loyaltyDiscount: item.loyaltyDiscount.toFixed(2),
          netTotalPrice: item.netTotalPrice.toFixed(2),
          netUnitPrice: item.netUnitPrice.toFixed(2),
          weightKg: item.weightKg !== null ? item.weightKg.toFixed(3) : null,
          volumeL: item.volumeL !== null ? item.volumeL.toFixed(3) : null,
          pricePerKgOrL:
            item.pricePerKgOrL !== null ? item.pricePerKgOrL.toFixed(2) : null,
          netPricePerKgOrL:
            item.netPricePerKgOrL !== null
              ? item.netPricePerKgOrL.toFixed(2)
              : null,
          unitType: item.unitType,
        }))
      );
    }
  } catch (err) {
    await db.delete(receipts).where(eq(receipts.id, receiptId));
    throw err;
  }

  return {
    inserted: true,
    skipped: false,
    retailer: parsed.retailer,
    externalId: parsed.externalId,
    ticketKey: parsed.ticketKey,
    storeName: parsed.storeName,
    totalPaid: parsed.totalPaid,
    itemCount: parsed.items.length,
    receiptId,
  };
}

/**
 * Import all *.pdf files (Carrefour & Monoprix) found in the workspace root directory.
 */
export async function syncLocalWorkspacePdfs(): Promise<{
  foundFiles: string[];
  insertedCount: number;
  skippedCount: number;
  results: UpsertResult[];
  errors: string[];
}> {
  const rootDir = process.cwd();
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(rootDir)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .sort();
  } catch {
    files = [];
  }

  const results: UpsertResult[] = [];
  const errors: string[] = [];

  for (const fileName of files) {
    try {
      const fullPath = path.join(rootDir, fileName);
      const buffer = fs.readFileSync(fullPath);
      const parsed = await parseReceiptPdf(buffer, fileName);
      const res = await insertParsedReceiptIfNew(parsed, "local_seed");
      results.push(res);
    } catch (err) {
      errors.push(
        `${fileName}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (results.some((r) => r.inserted)) {
    await setSyncSetting("last_sync_at", new Date().toISOString());
  }

  return {
    foundFiles: files,
    insertedCount: results.filter((r) => r.inserted).length,
    skippedCount: results.filter((r) => r.skipped).length,
    results,
    errors,
  };
}

/**
 * Automatically seed local PDFs on first run if the receipts table is empty.
 */
export async function autoSeedIfEmpty(): Promise<void> {
  const db = await ensureDbInitialized();
  const existing = await db
    .select({ id: receipts.id })
    .from(receipts)
    .limit(1);
  if (existing.length === 0) {
    await syncLocalWorkspacePdfs();
  }
}

export async function getSyncSetting(key: string): Promise<string | null> {
  const db = await ensureDbInitialized();
  const rows = await db
    .select({ value: syncSettings.value })
    .from(syncSettings)
    .where(eq(syncSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function setSyncSetting(
  key: string,
  value: string
): Promise<void> {
  const db = await ensureDbInitialized();
  await db
    .insert(syncSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: syncSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export interface ReceiptDetailItem {
  id: number;
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
  unitType: string | null;
}

export interface ReceiptListItem {
  id: number;
  retailer: Retailer;
  externalId: string;
  ticketKey: string;
  storeName: string;
  storeCode: string | null;
  purchaseDate: string;
  totalBeforeDiscount: number;
  totalImmediateDiscount: number;
  globalDiscount: number;
  extraFees: number;
  totalPaid: number;
  loyaltyCredited: number;
  paymentMethod: string | null;
  barcode: string | null;
  source: string;
  fileName: string | null;
  itemCount: number;
  items?: ReceiptDetailItem[];
}

export interface ReceiptStatsSummary {
  totalReceipts: number;
  carrefourCount: number;
  monoprixCount: number;
  totalSpent: number;
  carrefourSpent: number;
  monoprixSpent: number;
  totalImmediateSaved: number;
  totalGlobalDiscount: number;
  totalLoyaltySaved: number;
  totalSaved: number;
  lastSyncAt: string | null;
}

function toRetailer(val: string | null | undefined): Retailer {
  return val === "monoprix" ? "monoprix" : "carrefour";
}

export async function listReceipts(includeItems = false): Promise<{
  receipts: ReceiptListItem[];
  stats: ReceiptStatsSummary;
}> {
  await autoSeedIfEmpty();
  const db = await ensureDbInitialized();

  const rows = await db
    .select()
    .from(receipts)
    .orderBy(desc(receipts.purchaseDate));

  const allItems =
    rows.length > 0
      ? await db
          .select()
          .from(receiptItems)
          .where(
            inArray(
              receiptItems.receiptId,
              rows.map((r) => r.id)
            )
          )
      : [];

  const itemsByReceipt = new Map<number, ReceiptDetailItem[]>();
  for (const item of allItems) {
    const list = itemsByReceipt.get(item.receiptId) ?? [];
    list.push({
      id: item.id,
      lineIndex: item.lineIndex,
      rawLabel: item.rawLabel,
      normalizedLabel: item.normalizedLabel,
      vatRate: item.vatRate !== null ? Number(item.vatRate) : null,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      immediateDiscount: Number(item.immediateDiscount),
      loyaltyDiscount: Number(item.loyaltyDiscount),
      netTotalPrice: Number(item.netTotalPrice),
      netUnitPrice: Number(item.netUnitPrice),
      weightKg: item.weightKg !== null ? Number(item.weightKg) : null,
      volumeL: item.volumeL !== null ? Number(item.volumeL) : null,
      pricePerKgOrL:
        item.pricePerKgOrL !== null ? Number(item.pricePerKgOrL) : null,
      netPricePerKgOrL:
        item.netPricePerKgOrL !== null ? Number(item.netPricePerKgOrL) : null,
      unitType: item.unitType,
    });
    itemsByReceipt.set(item.receiptId, list);
  }

  for (const list of itemsByReceipt.values()) {
    list.sort((a, b) => a.lineIndex - b.lineIndex);
  }

  const formatted: ReceiptListItem[] = rows.map((r) => {
    const receiptItemList = itemsByReceipt.get(r.id) ?? [];
    return {
      id: r.id,
      retailer: toRetailer(r.retailer),
      externalId: r.externalId,
      ticketKey: r.ticketKey,
      storeName: r.storeName,
      storeCode: r.storeCode,
      purchaseDate: r.purchaseDate.toISOString(),
      totalBeforeDiscount: Number(r.totalBeforeDiscount),
      totalImmediateDiscount: Number(r.totalImmediateDiscount),
      globalDiscount: Number(r.globalDiscount),
      extraFees: Number(r.extraFees),
      totalPaid: Number(r.totalPaid),
      loyaltyCredited: Number(r.loyaltyCredited),
      paymentMethod: r.paymentMethod,
      barcode: r.barcode,
      source: r.source,
      fileName: r.fileName,
      itemCount: receiptItemList.length,
      ...(includeItems ? { items: receiptItemList } : {}),
    };
  });

  const carrefourRows = rows.filter((r) => toRetailer(r.retailer) === "carrefour");
  const monoprixRows = rows.filter((r) => toRetailer(r.retailer) === "monoprix");

  const totalSpent = rows.reduce((s, r) => s + Number(r.totalPaid), 0);
  const carrefourSpent = carrefourRows.reduce((s, r) => s + Number(r.totalPaid), 0);
  const monoprixSpent = monoprixRows.reduce((s, r) => s + Number(r.totalPaid), 0);
  const totalImmediateSaved = rows.reduce(
    (s, r) => s + Number(r.totalImmediateDiscount),
    0
  );
  const totalGlobalDiscount = rows.reduce(
    (s, r) => s + Number(r.globalDiscount),
    0
  );
  const totalLoyaltySaved = rows.reduce(
    (s, r) => s + Number(r.loyaltyCredited),
    0
  );
  const lastSyncAt = await getSyncSetting("last_sync_at");

  return {
    receipts: formatted,
    stats: {
      totalReceipts: rows.length,
      carrefourCount: carrefourRows.length,
      monoprixCount: monoprixRows.length,
      totalSpent: Math.round(totalSpent * 100) / 100,
      carrefourSpent: Math.round(carrefourSpent * 100) / 100,
      monoprixSpent: Math.round(monoprixSpent * 100) / 100,
      totalImmediateSaved: Math.round(totalImmediateSaved * 100) / 100,
      totalGlobalDiscount: Math.round(totalGlobalDiscount * 100) / 100,
      totalLoyaltySaved: Math.round(totalLoyaltySaved * 100) / 100,
      totalSaved:
        Math.round(
          (totalImmediateSaved + totalGlobalDiscount + totalLoyaltySaved) * 100
        ) / 100,
      lastSyncAt,
    },
  };
}

export interface AggregatedProductHistoryEntry {
  receiptId: number;
  retailer: Retailer;
  ticketKey: string;
  storeName: string;
  purchaseDate: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  immediateDiscount: number;
  loyaltyDiscount: number;
  netUnitPrice: number;
  netTotalPrice: number;
  weightKg: number | null;
  volumeL: number | null;
  pricePerKgOrL: number | null;
  netPricePerKgOrL: number | null;
  unitType: string | null;
}

export interface AggregatedProduct {
  key: string;
  retailer: Retailer;
  rawLabel: string;
  normalizedLabel: string;
  customName: string | null;
  monoprixPrice: number | null;
  monoprixUnit: string | null;
  notes: string | null;
  purchaseCount: number;
  totalQuantity: number;
  lastPurchaseDate: string;
  lastStoreName: string;
  lastUnitPrice: number;
  lastNetUnitPrice: number;
  lastPricePerKgOrL: number | null;
  lastNetPricePerKgOrL: number | null;
  unitType: string | null;
  minUnitPrice: number;
  maxUnitPrice: number;
  avgUnitPrice: number;
  minNetUnitPrice: number;
  avgNetUnitPrice: number;
  minPricePerKgOrL: number | null;
  maxPricePerKgOrL: number | null;
  priceTrendPct: number | null;
  history: AggregatedProductHistoryEntry[];
}

export async function listAggregatedProducts(
  query?: string,
  retailerFilter?: Retailer | "all"
): Promise<AggregatedProduct[]> {
  await autoSeedIfEmpty();
  const db = await ensureDbInitialized();

  const joined = await db
    .select({
      item: receiptItems,
      receipt: {
        id: receipts.id,
        retailer: receipts.retailer,
        ticketKey: receipts.ticketKey,
        storeName: receipts.storeName,
        purchaseDate: receipts.purchaseDate,
      },
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
    .orderBy(desc(receipts.purchaseDate));

  const noteRows = await db.select().from(productNotes);
  const notesMap = new Map(noteRows.map((n) => [n.rawLabel, n]));

  const groups = new Map<
    string,
    {
      key: string;
      retailer: Retailer;
      rawLabel: string;
      normalizedLabel: string;
      history: AggregatedProductHistoryEntry[];
    }
  >();

  for (const row of joined) {
    const it = row.item;
    const rec = row.receipt;
    const retailer = toRetailer(rec.retailer);

    if (retailerFilter && retailerFilter !== "all" && retailer !== retailerFilter) {
      continue;
    }

    const groupKey = `${retailer}::${it.rawLabel}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        retailer,
        rawLabel: it.rawLabel,
        normalizedLabel: it.normalizedLabel,
        history: [],
      };
      groups.set(groupKey, group);
    }

    group.history.push({
      receiptId: rec.id,
      retailer,
      ticketKey: rec.ticketKey,
      storeName: rec.storeName,
      purchaseDate: rec.purchaseDate.toISOString(),
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      totalPrice: Number(it.totalPrice),
      immediateDiscount: Number(it.immediateDiscount),
      loyaltyDiscount: Number(it.loyaltyDiscount),
      netUnitPrice: Number(it.netUnitPrice),
      netTotalPrice: Number(it.netTotalPrice),
      weightKg: it.weightKg !== null ? Number(it.weightKg) : null,
      volumeL: it.volumeL !== null ? Number(it.volumeL) : null,
      pricePerKgOrL:
        it.pricePerKgOrL !== null ? Number(it.pricePerKgOrL) : null,
      netPricePerKgOrL:
        it.netPricePerKgOrL !== null ? Number(it.netPricePerKgOrL) : null,
      unitType: it.unitType,
    });
  }

  const tokens = query
    ? stripAccents(query)
        .split(" ")
        .filter((t) => t.length > 0)
    : [];

  const products: AggregatedProduct[] = [];

  for (const group of groups.values()) {
    const note = notesMap.get(group.rawLabel);
    const searchable = stripAccents(
      `${group.retailer} ${group.rawLabel} ${group.normalizedLabel} ${note?.customName ?? ""} ${note?.notes ?? ""}`
    );

    if (
      tokens.length > 0 &&
      !tokens.every((token) => searchable.includes(token))
    ) {
      continue;
    }

    const latest = group.history[0];
    const totalQuantity = group.history.reduce((s, h) => s + h.quantity, 0);

    const unitPrices = group.history.map((h) => h.unitPrice);
    const netUnitPrices = group.history.map((h) => h.netUnitPrice);
    const kgPrices = group.history
      .map((h) => h.pricePerKgOrL)
      .filter((v): v is number => v !== null);

    const minUnitPrice = Math.min(...unitPrices);
    const maxUnitPrice = Math.max(...unitPrices);
    const avgUnitPrice =
      unitPrices.reduce((s, p) => s + p, 0) / unitPrices.length;

    const minNetUnitPrice = Math.min(...netUnitPrices);
    const avgNetUnitPrice =
      netUnitPrices.reduce((s, p) => s + p, 0) / netUnitPrices.length;

    const minPricePerKgOrL = kgPrices.length > 0 ? Math.min(...kgPrices) : null;
    const maxPricePerKgOrL = kgPrices.length > 0 ? Math.max(...kgPrices) : null;

    let priceTrendPct: number | null = null;
    if (group.history.length >= 2) {
      const oldest = group.history[group.history.length - 1];
      const latestComp = latest.pricePerKgOrL ?? latest.unitPrice;
      const oldestComp = oldest.pricePerKgOrL ?? oldest.unitPrice;
      if (oldestComp > 0 && latestComp !== oldestComp) {
        priceTrendPct =
          Math.round(((latestComp - oldestComp) / oldestComp) * 1000) / 10;
      }
    }

    products.push({
      key: group.key,
      retailer: group.retailer,
      rawLabel: group.rawLabel,
      normalizedLabel: group.normalizedLabel,
      customName: note?.customName ?? null,
      monoprixPrice:
        note?.monoprixPrice !== null && note?.monoprixPrice !== undefined
          ? Number(note.monoprixPrice)
          : null,
      monoprixUnit: note?.monoprixUnit ?? null,
      notes: note?.notes ?? null,
      purchaseCount: group.history.length,
      totalQuantity: Math.round(totalQuantity * 1000) / 1000,
      lastPurchaseDate: latest.purchaseDate,
      lastStoreName: latest.storeName,
      lastUnitPrice: latest.unitPrice,
      lastNetUnitPrice: latest.netUnitPrice,
      lastPricePerKgOrL: latest.pricePerKgOrL,
      lastNetPricePerKgOrL: latest.netPricePerKgOrL,
      unitType: latest.unitType,
      minUnitPrice: Math.round(minUnitPrice * 100) / 100,
      maxUnitPrice: Math.round(maxUnitPrice * 100) / 100,
      avgUnitPrice: Math.round(avgUnitPrice * 100) / 100,
      minNetUnitPrice: Math.round(minNetUnitPrice * 100) / 100,
      avgNetUnitPrice: Math.round(avgNetUnitPrice * 100) / 100,
      minPricePerKgOrL:
        minPricePerKgOrL !== null ? Math.round(minPricePerKgOrL * 100) / 100 : null,
      maxPricePerKgOrL:
        maxPricePerKgOrL !== null ? Math.round(maxPricePerKgOrL * 100) / 100 : null,
      priceTrendPct,
      history: group.history,
    });
  }

  return products;
}
