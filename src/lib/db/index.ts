import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { neon } from "@neondatabase/serverless";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

export type AppDb = PgliteDatabase<typeof schema>;

declare global {
  var __pgliteClient: PGlite | undefined;
  var __appDb: AppDb | undefined;
  var __dbInitPromise: Promise<void> | undefined;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS receipts (
    id SERIAL PRIMARY KEY,
    external_id TEXT NOT NULL UNIQUE,
    ticket_key TEXT NOT NULL,
    store_name TEXT NOT NULL,
    store_code TEXT,
    purchase_date TIMESTAMP NOT NULL,
    total_before_discount NUMERIC(10, 2) NOT NULL,
    total_immediate_discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_paid NUMERIC(10, 2) NOT NULL,
    loyalty_credited NUMERIC(10, 2) NOT NULL DEFAULT 0,
    payment_method TEXT,
    barcode TEXT,
    source TEXT NOT NULL DEFAULT 'pdf_upload',
    file_name TEXT,
    raw_text TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS receipt_items (
    id SERIAL PRIMARY KEY,
    receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    line_index INTEGER NOT NULL,
    raw_label TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    vat_rate NUMERIC(5, 2),
    quantity NUMERIC(10, 3) NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    total_price NUMERIC(10, 2) NOT NULL,
    immediate_discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    loyalty_discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    net_total_price NUMERIC(10, 2) NOT NULL,
    net_unit_price NUMERIC(10, 2) NOT NULL,
    weight_kg NUMERIC(10, 3),
    volume_l NUMERIC(10, 3),
    price_per_kg_or_l NUMERIC(10, 2),
    net_price_per_kg_or_l NUMERIC(10, 2),
    unit_type TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS product_notes (
    id SERIAL PRIMARY KEY,
    raw_label TEXT NOT NULL UNIQUE,
    custom_name TEXT,
    monoprix_price NUMERIC(10, 2),
    monoprix_unit TEXT,
    notes TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS sync_settings (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON receipt_items(receipt_id)`,
  `CREATE INDEX IF NOT EXISTS idx_receipt_items_raw_label ON receipt_items(raw_label)`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_purchase_date ON receipts(purchase_date DESC)`,
];

function createDbInstance(): { db: AppDb; isPostgresUrl: boolean } {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (
    databaseUrl &&
    (databaseUrl.startsWith("postgres://") ||
      databaseUrl.startsWith("postgresql://"))
  ) {
    const client = neon(databaseUrl);
    const db = drizzleNeon(client, { schema }) as unknown as AppDb;
    return { db, isPostgresUrl: true };
  }

  if (!globalThis.__pgliteClient) {
    const pgDataDir =
      process.env.PGLITE_DATA_DIR?.trim() ||
      (process.env.VERCEL || /onedrive/i.test(process.cwd())
        ? path.join(os.tmpdir(), "carrefour-tickets-pgdata")
        : path.join(process.cwd(), ".pgdata"));
    fs.mkdirSync(pgDataDir, { recursive: true });
    // PGlite runs in-process (WASM); a leftover postmaster.pid comes from an abrupt exit/HMR restart.
    const pidFile = path.join(pgDataDir, "postmaster.pid");
    if (fs.existsSync(pidFile)) {
      try {
        fs.unlinkSync(pidFile);
      } catch {
        // Ignore if locked
      }
    }
    globalThis.__pgliteClient = new PGlite(pgDataDir);
  }

  const db = drizzlePglite(globalThis.__pgliteClient, { schema });
  return { db, isPostgresUrl: false };
}

export async function closeDb(): Promise<void> {
  if (globalThis.__pgliteClient) {
    await globalThis.__pgliteClient.close();
    globalThis.__pgliteClient = undefined;
    globalThis.__appDb = undefined;
    globalThis.__dbInitPromise = undefined;
  }
}

export function getDb(): AppDb {
  if (!globalThis.__appDb) {
    const { db } = createDbInstance();
    globalThis.__appDb = db;
  }
  return globalThis.__appDb;
}

export function isUsingRemotePostgres(): boolean {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  return Boolean(
    databaseUrl &&
      (databaseUrl.startsWith("postgres://") ||
        databaseUrl.startsWith("postgresql://"))
  );
}

export async function ensureDbInitialized(): Promise<AppDb> {
  const db = getDb();
  if (!globalThis.__dbInitPromise) {
    globalThis.__dbInitPromise = (async () => {
      for (const stmt of SCHEMA_STATEMENTS) {
        await db.execute(sql.raw(stmt));
      }
    })().catch((err) => {
      globalThis.__dbInitPromise = undefined;
      throw err;
    });
  }
  await globalThis.__dbInitPromise;
  return db;
}
