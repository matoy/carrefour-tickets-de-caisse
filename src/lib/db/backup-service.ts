import zlib from "node:zlib";
import { asc, eq } from "drizzle-orm";
import { ensureDbInitialized } from "./index";
import {
  dismissedComparisonSuggestions,
  productComparisonLinks,
  productComparisons,
  productNotes,
  receiptItems,
  receipts,
  syncSettings,
} from "./schema";
import { maskPersonalInfo } from "../parser/normalize";

export const BACKUP_FORMAT = "carrefour-monoprix-backup" as const;
export const BACKUP_VERSION = 1 as const;
export const MAX_BACKUP_UPLOAD_BYTES = Math.floor(4.5 * 1024 * 1024);
const MAX_DECOMPRESSED_BYTES = 25 * 1024 * 1024;

export type BackupImportMode = "merge" | "replace";

export interface BackupReceiptItem {
  lineIndex: number;
  rawLabel: string;
  normalizedLabel: string;
  vatRate: string | null;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  immediateDiscount: string;
  loyaltyDiscount: string;
  netTotalPrice: string;
  netUnitPrice: string;
  weightKg: string | null;
  volumeL: string | null;
  pricePerKgOrL: string | null;
  netPricePerKgOrL: string | null;
  unitType: string | null;
}

export interface BackupReceipt {
  externalId: string;
  retailer: string;
  ticketKey: string;
  storeName: string;
  storeCode: string | null;
  purchaseDate: string;
  totalBeforeDiscount: string;
  totalImmediateDiscount: string;
  globalDiscount: string;
  extraFees: string;
  totalPaid: string;
  loyaltyCredited: string;
  paymentMethod: string | null;
  barcode: string | null;
  source: string;
  fileName: string | null;
  rawText: string | null;
  createdAt: string;
  items: BackupReceiptItem[];
}

export interface BackupProductNote {
  rawLabel: string;
  customName: string | null;
  monoprixPrice: string | null;
  monoprixUnit: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface BackupComparisonLink {
  retailer: "carrefour" | "monoprix";
  rawLabel: string;
}

export interface BackupComparison {
  name: string;
  compareMode: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  links: BackupComparisonLink[];
}

export interface BackupDismissedSuggestion {
  carrefourLabel: string;
  monoprixLabel: string;
  createdAt: string;
}

export interface BackupSyncSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export interface DatabaseBackupV1 {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  receipts: BackupReceipt[];
  productNotes: BackupProductNote[];
  comparisons: BackupComparison[];
  dismissedSuggestions: BackupDismissedSuggestion[];
  syncSettings: BackupSyncSetting[];
}

export interface BackupPreviewSummary {
  exportedAt: string;
  compressedBytes: number;
  uncompressedBytes: number;
  archive: {
    receipts: number;
    items: number;
    productNotes: number;
    comparisons: number;
    dismissedSuggestions: number;
    syncSettings: number;
  };
  currentDb: {
    receipts: number;
    comparisons: number;
    productNotes: number;
    dismissedSuggestions: number;
  };
  mergeDiff: {
    newReceipts: number;
    skippedReceipts: number;
    newItems: number;
    newComparisons: number;
    mergedComparisons: number;
    newProductNotes: number;
    updatedProductNotes: number;
    newDismissedSuggestions: number;
  };
}

export interface BackupImportReport {
  mode: BackupImportMode;
  insertedReceipts: number;
  skippedReceipts: number;
  insertedItems: number;
  upsertedNotes: number;
  insertedComparisons: number;
  mergedComparisons: number;
  insertedDismissedSuggestions: number;
  upsertedSettings: number;
}

function toFixedOrNull(
  value: unknown,
  decimals: number
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(decimals);
}

function toFixedOrDefault(
  value: unknown,
  decimals: number,
  fallback = "0.00"
): string {
  return toFixedOrNull(value, decimals) ?? fallback;
}

function parseIsoDate(value: unknown, fallback = new Date()): Date {
  if (typeof value === "string" || value instanceof Date) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

/**
 * Export the entire PostgreSQL database into a versioned JSON payload and Gzip buffer.
 */
export async function exportDatabaseBackup(): Promise<{
  payload: DatabaseBackupV1;
  gzipBuffer: Buffer;
  fileName: string;
}> {
  const db = await ensureDbInitialized();

  const [
    receiptRows,
    itemRows,
    noteRows,
    comparisonRows,
    linkRows,
    dismissedRows,
    settingRows,
  ] = await Promise.all([
    db.select().from(receipts).orderBy(asc(receipts.purchaseDate)),
    db
      .select()
      .from(receiptItems)
      .orderBy(asc(receiptItems.receiptId), asc(receiptItems.lineIndex)),
    db.select().from(productNotes).orderBy(asc(productNotes.rawLabel)),
    db.select().from(productComparisons).orderBy(asc(productComparisons.name)),
    db.select().from(productComparisonLinks),
    db.select().from(dismissedComparisonSuggestions),
    db.select().from(syncSettings).orderBy(asc(syncSettings.key)),
  ]);

  const itemsByReceipt = new Map<number, BackupReceiptItem[]>();
  for (const it of itemRows) {
    const list = itemsByReceipt.get(it.receiptId) ?? [];
    list.push({
      lineIndex: it.lineIndex,
      rawLabel: it.rawLabel,
      normalizedLabel: it.normalizedLabel,
      vatRate: it.vatRate,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      totalPrice: it.totalPrice,
      immediateDiscount: it.immediateDiscount,
      loyaltyDiscount: it.loyaltyDiscount,
      netTotalPrice: it.netTotalPrice,
      netUnitPrice: it.netUnitPrice,
      weightKg: it.weightKg,
      volumeL: it.volumeL,
      pricePerKgOrL: it.pricePerKgOrL,
      netPricePerKgOrL: it.netPricePerKgOrL,
      unitType: it.unitType,
    });
    itemsByReceipt.set(it.receiptId, list);
  }

  const linksByComparison = new Map<number, BackupComparisonLink[]>();
  for (const lk of linkRows) {
    const list = linksByComparison.get(lk.comparisonId) ?? [];
    list.push({
      retailer: lk.retailer === "monoprix" ? "monoprix" : "carrefour",
      rawLabel: lk.rawLabel,
    });
    linksByComparison.set(lk.comparisonId, list);
  }

  const now = new Date();
  const payload: DatabaseBackupV1 = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    receipts: receiptRows.map((r) => ({
      externalId: r.externalId,
      retailer: r.retailer === "monoprix" ? "monoprix" : "carrefour",
      ticketKey: r.ticketKey,
      storeName: r.storeName,
      storeCode: r.storeCode,
      purchaseDate: r.purchaseDate.toISOString(),
      totalBeforeDiscount: r.totalBeforeDiscount,
      totalImmediateDiscount: r.totalImmediateDiscount,
      globalDiscount: r.globalDiscount,
      extraFees: r.extraFees,
      totalPaid: r.totalPaid,
      loyaltyCredited: r.loyaltyCredited,
      paymentMethod: r.paymentMethod,
      barcode: r.barcode,
      source: r.source,
      fileName: r.fileName,
      rawText: r.rawText ? maskPersonalInfo(r.rawText) : null,
      createdAt: r.createdAt.toISOString(),
      items: itemsByReceipt.get(r.id) ?? [],
    })),
    productNotes: noteRows.map((n) => ({
      rawLabel: n.rawLabel,
      customName: n.customName,
      monoprixPrice: n.monoprixPrice,
      monoprixUnit: n.monoprixUnit,
      notes: n.notes,
      updatedAt: n.updatedAt.toISOString(),
    })),
    comparisons: comparisonRows.map((c) => ({
      name: c.name,
      compareMode: c.compareMode === "per_kg_or_l" ? "per_kg_or_l" : "unit",
      notes: c.notes,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      links: linksByComparison.get(c.id) ?? [],
    })),
    dismissedSuggestions: dismissedRows.map((d) => ({
      carrefourLabel: d.carrefourLabel,
      monoprixLabel: d.monoprixLabel,
      createdAt: d.createdAt.toISOString(),
    })),
    syncSettings: settingRows.map((s) => ({
      key: s.key,
      value: s.value,
      updatedAt: s.updatedAt.toISOString(),
    })),
  };

  const jsonBuffer = Buffer.from(JSON.stringify(payload), "utf-8");
  const gzipBuffer = zlib.gzipSync(jsonBuffer, { level: 9 });

  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-") +
    "-" +
    [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
    ].join("");

  return {
    payload,
    gzipBuffer,
    fileName: `courses-backup-${stamp}.json.gz`,
  };
}

/**
 * Decode a .json.gz (or plain .json) backup buffer and validate its structure.
 */
export function decodeAndValidateBackupBuffer(buffer: Buffer): {
  backup: DatabaseBackupV1;
  compressedBytes: number;
  uncompressedBytes: number;
} {
  if (buffer.length === 0) {
    throw new Error("Le fichier de sauvegarde est vide.");
  }
  if (buffer.length > MAX_BACKUP_UPLOAD_BYTES) {
    throw new Error("Le fichier dépasse la limite autorisée de 4,5 Mo.");
  }

  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  let jsonBuf: Buffer;
  try {
    jsonBuf = isGzip
      ? zlib.gunzipSync(buffer, { maxOutputLength: MAX_DECOMPRESSED_BYTES })
      : buffer;
  } catch {
    throw new Error(
      "Impossible de décompresser l'archive .json.gz (fichier corrompu ou trop volumineux)."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBuf.toString("utf-8"));
  } catch {
    throw new Error("Le contenu décompressé n'est pas un JSON valide.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Structure de sauvegarde invalide.");
  }

  const candidate = parsed as Partial<DatabaseBackupV1>;
  if (candidate.format !== BACKUP_FORMAT) {
    throw new Error(
      "Ce fichier n'est pas une sauvegarde de Mes Courses (format non reconnu)."
    );
  }
  if (candidate.version !== BACKUP_VERSION) {
    throw new Error(
      `Version de sauvegarde non supportée (${String(candidate.version)}).`
    );
  }
  if (
    !Array.isArray(candidate.receipts) ||
    !Array.isArray(candidate.productNotes) ||
    !Array.isArray(candidate.comparisons) ||
    !Array.isArray(candidate.dismissedSuggestions) ||
    !Array.isArray(candidate.syncSettings)
  ) {
    throw new Error(
      "La sauvegarde est incomplète : certaines tables attendues sont absentes."
    );
  }

  for (const rec of candidate.receipts) {
    if (
      !rec ||
      typeof rec.externalId !== "string" ||
      typeof rec.ticketKey !== "string" ||
      typeof rec.storeName !== "string" ||
      !Array.isArray(rec.items)
    ) {
      throw new Error(
        "Un ticket dans la sauvegarde présente une structure invalide."
      );
    }
  }

  return {
    backup: candidate as DatabaseBackupV1,
    compressedBytes: buffer.length,
    uncompressedBytes: jsonBuf.length,
  };
}

/**
 * Compare a validated backup against the current database without modifying any row.
 */
export async function previewDatabaseBackup(
  backup: DatabaseBackupV1,
  sizes: { compressedBytes: number; uncompressedBytes: number }
): Promise<BackupPreviewSummary> {
  const db = await ensureDbInitialized();

  const [existingReceipts, existingNotes, existingComparisons, existingDismissed] =
    await Promise.all([
      db.select({ externalId: receipts.externalId }).from(receipts),
      db.select({ rawLabel: productNotes.rawLabel }).from(productNotes),
      db.select({ name: productComparisons.name }).from(productComparisons),
      db.select().from(dismissedComparisonSuggestions),
    ]);

  const existingExternalIds = new Set(existingReceipts.map((r) => r.externalId));
  const existingNoteLabels = new Set(existingNotes.map((n) => n.rawLabel));
  const existingCompNames = new Set(
    existingComparisons.map((c) => c.name.trim().toLowerCase())
  );
  const existingDismissedKeys = new Set(
    existingDismissed.map((d) => `${d.carrefourLabel}::${d.monoprixLabel}`)
  );

  let newReceipts = 0;
  let skippedReceipts = 0;
  let newItems = 0;
  let totalArchiveItems = 0;

  for (const r of backup.receipts) {
    totalArchiveItems += r.items.length;
    if (existingExternalIds.has(r.externalId)) {
      skippedReceipts += 1;
    } else {
      newReceipts += 1;
      newItems += r.items.length;
    }
  }

  let newComparisons = 0;
  let mergedComparisons = 0;
  for (const c of backup.comparisons) {
    if (existingCompNames.has(c.name.trim().toLowerCase())) {
      mergedComparisons += 1;
    } else {
      newComparisons += 1;
    }
  }

  let newProductNotes = 0;
  let updatedProductNotes = 0;
  for (const n of backup.productNotes) {
    if (existingNoteLabels.has(n.rawLabel)) {
      updatedProductNotes += 1;
    } else {
      newProductNotes += 1;
    }
  }

  let newDismissedSuggestions = 0;
  for (const d of backup.dismissedSuggestions) {
    if (!existingDismissedKeys.has(`${d.carrefourLabel}::${d.monoprixLabel}`)) {
      newDismissedSuggestions += 1;
    }
  }

  return {
    exportedAt: backup.exportedAt,
    compressedBytes: sizes.compressedBytes,
    uncompressedBytes: sizes.uncompressedBytes,
    archive: {
      receipts: backup.receipts.length,
      items: totalArchiveItems,
      productNotes: backup.productNotes.length,
      comparisons: backup.comparisons.length,
      dismissedSuggestions: backup.dismissedSuggestions.length,
      syncSettings: backup.syncSettings.length,
    },
    currentDb: {
      receipts: existingReceipts.length,
      comparisons: existingComparisons.length,
      productNotes: existingNotes.length,
      dismissedSuggestions: existingDismissed.length,
    },
    mergeDiff: {
      newReceipts,
      skippedReceipts,
      newItems,
      newComparisons,
      mergedComparisons,
      newProductNotes,
      updatedProductNotes,
      newDismissedSuggestions,
    },
  };
}

/**
 * Import a validated backup into PostgreSQL in "merge" or "replace" mode.
 */
export async function importDatabaseBackup(
  backup: DatabaseBackupV1,
  mode: BackupImportMode
): Promise<BackupImportReport> {
  const db = await ensureDbInitialized();

  if (mode === "replace") {
    await db.delete(productComparisonLinks);
    await db.delete(productComparisons);
    await db.delete(dismissedComparisonSuggestions);
    await db.delete(productNotes);
    await db.delete(receiptItems);
    await db.delete(receipts);
    await db.delete(syncSettings);
  }

  const existingReceipts =
    mode === "replace"
      ? []
      : await db.select({ externalId: receipts.externalId }).from(receipts);
  const existingExternalIds = new Set(existingReceipts.map((r) => r.externalId));

  let insertedReceipts = 0;
  let skippedReceipts = 0;
  let insertedItems = 0;

  for (const r of backup.receipts) {
    if (existingExternalIds.has(r.externalId)) {
      skippedReceipts += 1;
      continue;
    }

    const insertedRows = await db
      .insert(receipts)
      .values({
        externalId: r.externalId,
        retailer: r.retailer === "monoprix" ? "monoprix" : "carrefour",
        ticketKey: r.ticketKey,
        storeName: r.storeName,
        storeCode: r.storeCode ?? null,
        purchaseDate: parseIsoDate(r.purchaseDate),
        totalBeforeDiscount: toFixedOrDefault(r.totalBeforeDiscount, 2),
        totalImmediateDiscount: toFixedOrDefault(r.totalImmediateDiscount, 2),
        globalDiscount: toFixedOrDefault(r.globalDiscount, 2),
        extraFees: toFixedOrDefault(r.extraFees, 2),
        totalPaid: toFixedOrDefault(r.totalPaid, 2),
        loyaltyCredited: toFixedOrDefault(r.loyaltyCredited, 2),
        paymentMethod: r.paymentMethod ?? null,
        barcode: r.barcode ?? null,
        source: r.source || "backup_import",
        fileName: r.fileName ?? null,
        rawText: r.rawText ? maskPersonalInfo(r.rawText) : null,
        createdAt: parseIsoDate(r.createdAt),
      })
      .onConflictDoNothing({ target: receipts.externalId })
      .returning({ id: receipts.id });

    if (insertedRows.length === 0) {
      skippedReceipts += 1;
      continue;
    }

    const receiptId = insertedRows[0].id;
    try {
      if (r.items.length > 0) {
        await db.insert(receiptItems).values(
          r.items.map((it, idx) => ({
            receiptId,
            lineIndex: Number.isInteger(it.lineIndex) ? it.lineIndex : idx,
            rawLabel: it.rawLabel,
            normalizedLabel: it.normalizedLabel,
            vatRate: toFixedOrNull(it.vatRate, 2),
            quantity: toFixedOrDefault(it.quantity, 3, "1.000"),
            unitPrice: toFixedOrDefault(it.unitPrice, 2),
            totalPrice: toFixedOrDefault(it.totalPrice, 2),
            immediateDiscount: toFixedOrDefault(it.immediateDiscount, 2),
            loyaltyDiscount: toFixedOrDefault(it.loyaltyDiscount, 2),
            netTotalPrice: toFixedOrDefault(it.netTotalPrice, 2),
            netUnitPrice: toFixedOrDefault(it.netUnitPrice, 2),
            weightKg: toFixedOrNull(it.weightKg, 3),
            volumeL: toFixedOrNull(it.volumeL, 3),
            pricePerKgOrL: toFixedOrNull(it.pricePerKgOrL, 2),
            netPricePerKgOrL: toFixedOrNull(it.netPricePerKgOrL, 2),
            unitType: it.unitType ?? null,
          }))
        );
        insertedItems += r.items.length;
      }
      insertedReceipts += 1;
      existingExternalIds.add(r.externalId);
    } catch (err) {
      await db.delete(receipts).where(eq(receipts.id, receiptId));
      throw err;
    }
  }

  let upsertedNotes = 0;
  for (const n of backup.productNotes) {
    if (!n.rawLabel?.trim()) continue;
    await db
      .insert(productNotes)
      .values({
        rawLabel: n.rawLabel.trim(),
        customName: n.customName ?? null,
        monoprixPrice: toFixedOrNull(n.monoprixPrice, 2),
        monoprixUnit: n.monoprixUnit ?? null,
        notes: n.notes ?? null,
        updatedAt: parseIsoDate(n.updatedAt),
      })
      .onConflictDoUpdate({
        target: productNotes.rawLabel,
        set: {
          customName: n.customName ?? null,
          monoprixPrice: toFixedOrNull(n.monoprixPrice, 2),
          monoprixUnit: n.monoprixUnit ?? null,
          notes: n.notes ?? null,
          updatedAt: parseIsoDate(n.updatedAt),
        },
      });
    upsertedNotes += 1;
  }

  const existingCompRows =
    mode === "replace"
      ? []
      : await db.select().from(productComparisons);
  const existingCompByName = new Map<string, number>();
  for (const c of existingCompRows) {
    existingCompByName.set(c.name.trim().toLowerCase(), c.id);
  }

  let insertedComparisons = 0;
  let mergedComparisons = 0;

  for (const c of backup.comparisons) {
    const cleanName = c.name?.trim();
    if (!cleanName) continue;
    const key = cleanName.toLowerCase();
    let compId = existingCompByName.get(key);

    if (compId !== undefined) {
      mergedComparisons += 1;
    } else {
      const created = await db
        .insert(productComparisons)
        .values({
          name: cleanName,
          compareMode:
            c.compareMode === "per_kg_or_l" ? "per_kg_or_l" : "unit",
          notes: c.notes ?? null,
          createdAt: parseIsoDate(c.createdAt),
          updatedAt: parseIsoDate(c.updatedAt),
        })
        .returning({ id: productComparisons.id });
      compId = created[0].id;
      existingCompByName.set(key, compId);
      insertedComparisons += 1;
    }

    if (Array.isArray(c.links) && c.links.length > 0) {
      const cleanLinks = c.links
        .filter((lk) => lk.rawLabel?.trim())
        .map((lk) => ({
          comparisonId: compId,
          retailer: (lk.retailer === "monoprix" ? "monoprix" : "carrefour") as
            | "carrefour"
            | "monoprix",
          rawLabel: lk.rawLabel.trim(),
        }));
      if (cleanLinks.length > 0) {
        await db
          .insert(productComparisonLinks)
          .values(cleanLinks)
          .onConflictDoNothing();
      }
    }
  }

  const existingDismissed =
    mode === "replace"
      ? []
      : await db.select().from(dismissedComparisonSuggestions);
  const existingDismissedSet = new Set(
    existingDismissed.map((d) => `${d.carrefourLabel}::${d.monoprixLabel}`)
  );

  let insertedDismissedSuggestions = 0;
  for (const d of backup.dismissedSuggestions) {
    const cLbl = d.carrefourLabel?.trim();
    const mLbl = d.monoprixLabel?.trim();
    if (!cLbl || !mLbl) continue;
    const key = `${cLbl}::${mLbl}`;
    if (existingDismissedSet.has(key)) continue;

    await db
      .insert(dismissedComparisonSuggestions)
      .values({
        carrefourLabel: cLbl,
        monoprixLabel: mLbl,
        createdAt: parseIsoDate(d.createdAt),
      })
      .onConflictDoNothing();
    existingDismissedSet.add(key);
    insertedDismissedSuggestions += 1;
  }

  let upsertedSettings = 0;
  for (const s of backup.syncSettings) {
    if (!s.key?.trim()) continue;
    await db
      .insert(syncSettings)
      .values({
        key: s.key.trim(),
        value: String(s.value ?? ""),
        updatedAt: parseIsoDate(s.updatedAt),
      })
      .onConflictDoUpdate({
        target: syncSettings.key,
        set: {
          value: String(s.value ?? ""),
          updatedAt: parseIsoDate(s.updatedAt),
        },
      });
    upsertedSettings += 1;
  }

  return {
    mode,
    insertedReceipts,
    skippedReceipts,
    insertedItems,
    upsertedNotes,
    insertedComparisons,
    mergedComparisons,
    insertedDismissedSuggestions,
    upsertedSettings,
  };
}
