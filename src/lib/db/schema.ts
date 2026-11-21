import {
  pgTable,
  serial,
  text,
  timestamp,
  numeric,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  retailer: text("retailer").notNull().default("carrefour"),
  ticketKey: text("ticket_key").notNull(),
  storeName: text("store_name").notNull(),
  storeCode: text("store_code"),
  purchaseDate: timestamp("purchase_date", { withTimezone: false }).notNull(),
  totalBeforeDiscount: numeric("total_before_discount", {
    precision: 10,
    scale: 2,
  }).notNull(),
  totalImmediateDiscount: numeric("total_immediate_discount", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("0"),
  globalDiscount: numeric("global_discount", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("0"),
  extraFees: numeric("extra_fees", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("0"),
  totalPaid: numeric("total_paid", { precision: 10, scale: 2 }).notNull(),
  loyaltyCredited: numeric("loyalty_credited", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("0"),
  paymentMethod: text("payment_method"),
  barcode: text("barcode"),
  source: text("source").notNull().default("pdf_upload"),
  fileName: text("file_name"),
  rawText: text("raw_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const receiptItems = pgTable("receipt_items", {
  id: serial("id").primaryKey(),
  receiptId: integer("receipt_id")
    .notNull()
    .references(() => receipts.id, { onDelete: "cascade" }),
  lineIndex: integer("line_index").notNull(),
  rawLabel: text("raw_label").notNull(),
  normalizedLabel: text("normalized_label").notNull(),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
  immediateDiscount: numeric("immediate_discount", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("0"),
  loyaltyDiscount: numeric("loyalty_discount", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("0"),
  netTotalPrice: numeric("net_total_price", {
    precision: 10,
    scale: 2,
  }).notNull(),
  netUnitPrice: numeric("net_unit_price", {
    precision: 10,
    scale: 2,
  }).notNull(),
  weightKg: numeric("weight_kg", { precision: 10, scale: 3 }),
  volumeL: numeric("volume_l", { precision: 10, scale: 3 }),
  pricePerKgOrL: numeric("price_per_kg_or_l", { precision: 10, scale: 2 }),
  netPricePerKgOrL: numeric("net_price_per_kg_or_l", {
    precision: 10,
    scale: 2,
  }),
  unitType: text("unit_type"),
});

export const productNotes = pgTable("product_notes", {
  id: serial("id").primaryKey(),
  rawLabel: text("raw_label").notNull().unique(),
  customName: text("custom_name"),
  monoprixPrice: numeric("monoprix_price", { precision: 10, scale: 2 }),
  monoprixUnit: text("monoprix_unit"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const productComparisons = pgTable("product_comparisons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  compareMode: text("compare_mode").notNull().default("unit"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const productComparisonLinks = pgTable(
  "product_comparison_links",
  {
    id: serial("id").primaryKey(),
    comparisonId: integer("comparison_id")
      .notNull()
      .references(() => productComparisons.id, { onDelete: "cascade" }),
    retailer: text("retailer").notNull(),
    rawLabel: text("raw_label").notNull(),
  },
  (table) => [
    uniqueIndex("idx_comparison_link_unique").on(
      table.comparisonId,
      table.retailer,
      table.rawLabel
    ),
  ]
);

export const syncSettings = pgTable("sync_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const dismissedComparisonSuggestions = pgTable(
  "dismissed_comparison_suggestions",
  {
    id: serial("id").primaryKey(),
    carrefourLabel: text("carrefour_label").notNull(),
    monoprixLabel: text("monoprix_label").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_dismissed_suggestion_unique").on(
      table.carrefourLabel,
      table.monoprixLabel
    ),
  ]
);

export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
export type ReceiptItem = typeof receiptItems.$inferSelect;
export type NewReceiptItem = typeof receiptItems.$inferInsert;
export type ProductNote = typeof productNotes.$inferSelect;
export type ProductComparison = typeof productComparisons.$inferSelect;
export type ProductComparisonLink = typeof productComparisonLinks.$inferSelect;
export type DismissedComparisonSuggestion =
  typeof dismissedComparisonSuggestions.$inferSelect;
export type SyncSetting = typeof syncSettings.$inferSelect;
