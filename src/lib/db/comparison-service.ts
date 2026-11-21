import { and, asc, eq } from "drizzle-orm";
import { ensureDbInitialized } from "./index";
import {
  dismissedComparisonSuggestions,
  productComparisons,
  productComparisonLinks,
} from "./schema";
import {
  listAggregatedProducts,
  type AggregatedProduct,
} from "./receipt-service";
import type { Retailer } from "../parser";
import { extractMatchTokens } from "../parser/normalize";

export type CompareMode = "unit" | "per_kg_or_l";
export type DuelWinner = "carrefour" | "monoprix" | "tie" | "incomplete";

export interface DuelBasisResult {
  carrefourPrice: number | null;
  monoprixPrice: number | null;
  unitLabel: string;
  winner: DuelWinner;
  savingsAmount: number | null;
  savingsPct: number | null;
}

export interface ProductComparisonView {
  id: number;
  name: string;
  compareMode: CompareMode;
  notes: string | null;
  carrefourLabels: string[];
  monoprixLabels: string[];
  carrefourProduct: AggregatedProduct | null;
  monoprixProduct: AggregatedProduct | null;
  carrefourAllProducts: AggregatedProduct[];
  monoprixAllProducts: AggregatedProduct[];
  net: DuelBasisResult;
  shelf: DuelBasisResult;
}

export interface SuggestedComparisonMatch {
  suggestedName: string;
  recommendedMode: CompareMode;
  score: number;
  sharedTokens: string[];
  carrefourProduct: AggregatedProduct;
  monoprixProduct: AggregatedProduct;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pickRepresentativeProduct(
  linked: AggregatedProduct[]
): AggregatedProduct | null {
  if (linked.length === 0) return null;
  const sorted = [...linked].sort(
    (a, b) =>
      new Date(b.lastPurchaseDate).getTime() -
      new Date(a.lastPurchaseDate).getTime()
  );
  return sorted[0];
}

function extractProductPrice(
  product: AggregatedProduct | null,
  compareMode: CompareMode,
  basis: "net" | "shelf"
): { price: number | null; unitLabel: string } {
  if (!product) return { price: null, unitLabel: "€" };

  if (compareMode === "per_kg_or_l") {
    const perUnit =
      basis === "net"
        ? product.lastNetPricePerKgOrL ?? product.lastPricePerKgOrL
        : product.lastPricePerKgOrL;
    if (perUnit !== null) {
      return {
        price: perUnit,
        unitLabel: product.unitType === "L" ? "€/L" : "€/kg",
      };
    }
  }

  return {
    price: basis === "net" ? product.lastNetUnitPrice : product.lastUnitPrice,
    unitLabel: "€",
  };
}

function evaluateBasis(
  carrefour: AggregatedProduct | null,
  monoprix: AggregatedProduct | null,
  compareMode: CompareMode,
  basis: "net" | "shelf"
): DuelBasisResult {
  const cVal = extractProductPrice(carrefour, compareMode, basis);
  const mVal = extractProductPrice(monoprix, compareMode, basis);

  const unitLabel =
    compareMode === "per_kg_or_l"
      ? cVal.unitLabel !== "€"
        ? cVal.unitLabel
        : mVal.unitLabel
      : "€";

  if (cVal.price === null || mVal.price === null) {
    return {
      carrefourPrice: cVal.price,
      monoprixPrice: mVal.price,
      unitLabel,
      winner: "incomplete",
      savingsAmount: null,
      savingsPct: null,
    };
  }

  const diff = round2(mVal.price - cVal.price);
  if (Math.abs(diff) < 0.01) {
    return {
      carrefourPrice: cVal.price,
      monoprixPrice: mVal.price,
      unitLabel,
      winner: "tie",
      savingsAmount: 0,
      savingsPct: 0,
    };
  }

  if (diff > 0) {
    const pct = mVal.price > 0 ? Math.round((diff / mVal.price) * 1000) / 10 : 0;
    return {
      carrefourPrice: cVal.price,
      monoprixPrice: mVal.price,
      unitLabel,
      winner: "carrefour",
      savingsAmount: diff,
      savingsPct: pct,
    };
  }

  const absDiff = Math.abs(diff);
  const pct = cVal.price > 0 ? Math.round((absDiff / cVal.price) * 1000) / 10 : 0;
  return {
    carrefourPrice: cVal.price,
    monoprixPrice: mVal.price,
    unitLabel,
    winner: "monoprix",
    savingsAmount: absDiff,
    savingsPct: pct,
  };
}

export async function listComparisonsWithPrices(
  preloadedProducts?: AggregatedProduct[]
): Promise<ProductComparisonView[]> {
  const db = await ensureDbInitialized();
  const products = preloadedProducts ?? (await listAggregatedProducts());

  const productMap = new Map<string, AggregatedProduct>();
  for (const p of products) {
    productMap.set(`${p.retailer}::${p.rawLabel}`, p);
  }

  const compRows = await db
    .select()
    .from(productComparisons)
    .orderBy(asc(productComparisons.name));

  const linkRows = await db.select().from(productComparisonLinks);
  const linksByComp = new Map<
    number,
    Array<{ retailer: Retailer; rawLabel: string }>
  >();

  for (const link of linkRows) {
    const list = linksByComp.get(link.comparisonId) ?? [];
    list.push({
      retailer: link.retailer === "monoprix" ? "monoprix" : "carrefour",
      rawLabel: link.rawLabel,
    });
    linksByComp.set(link.comparisonId, list);
  }

  return compRows.map((comp) => {
    const compareMode: CompareMode =
      comp.compareMode === "per_kg_or_l" ? "per_kg_or_l" : "unit";
    const links = linksByComp.get(comp.id) ?? [];

    const carrefourLabels = links
      .filter((l) => l.retailer === "carrefour")
      .map((l) => l.rawLabel);
    const monoprixLabels = links
      .filter((l) => l.retailer === "monoprix")
      .map((l) => l.rawLabel);

    const carrefourAllProducts = carrefourLabels
      .map((lbl) => productMap.get(`carrefour::${lbl}`))
      .filter((p): p is AggregatedProduct => Boolean(p));
    const monoprixAllProducts = monoprixLabels
      .map((lbl) => productMap.get(`monoprix::${lbl}`))
      .filter((p): p is AggregatedProduct => Boolean(p));

    const carrefourProduct = pickRepresentativeProduct(carrefourAllProducts);
    const monoprixProduct = pickRepresentativeProduct(monoprixAllProducts);

    return {
      id: comp.id,
      name: comp.name,
      compareMode,
      notes: comp.notes,
      carrefourLabels,
      monoprixLabels,
      carrefourProduct,
      monoprixProduct,
      carrefourAllProducts,
      monoprixAllProducts,
      net: evaluateBasis(carrefourProduct, monoprixProduct, compareMode, "net"),
      shelf: evaluateBasis(
        carrefourProduct,
        monoprixProduct,
        compareMode,
        "shelf"
      ),
    };
  });
}

function formatSuggestedName(monoprixRawLabel: string): string {
  return monoprixRawLabel.replace(/\s+/g, " ").trim();
}

/**
 * Compute likely Carrefour <-> Monoprix product pairs not yet linked or dismissed.
 */
export function computeSuggestedMatches(
  products: AggregatedProduct[],
  existingComparisons: ProductComparisonView[],
  dismissedKeys?: Set<string>
): SuggestedComparisonMatch[] {
  const alreadyLinkedCarrefour = new Set<string>();
  const alreadyLinkedMonoprix = new Set<string>();
  for (const comp of existingComparisons) {
    for (const lbl of comp.carrefourLabels) alreadyLinkedCarrefour.add(lbl);
    for (const lbl of comp.monoprixLabels) alreadyLinkedMonoprix.add(lbl);
  }

  const carrefourList = products.filter(
    (p) => p.retailer === "carrefour" && !alreadyLinkedCarrefour.has(p.rawLabel)
  );
  const monoprixList = products.filter(
    (p) => p.retailer === "monoprix" && !alreadyLinkedMonoprix.has(p.rawLabel)
  );

  if (carrefourList.length === 0 || monoprixList.length === 0) {
    return [];
  }

  const monoprixTokens = monoprixList.map((m) => ({
    product: m,
    tokens: extractMatchTokens(m.rawLabel, m.normalizedLabel),
  }));

  const candidates: SuggestedComparisonMatch[] = [];

  for (const c of carrefourList) {
    const cTokens = extractMatchTokens(c.rawLabel, c.normalizedLabel);
    if (cTokens.length === 0) continue;
    const cSet = new Set(cTokens);

    let best: SuggestedComparisonMatch | null = null;

    for (const mEntry of monoprixTokens) {
      if (
        dismissedKeys?.has(`${c.rawLabel}::${mEntry.product.rawLabel}`)
      ) {
        continue;
      }
      if (mEntry.tokens.length === 0) continue;
      const shared = mEntry.tokens.filter((t) => cSet.has(t));
      if (shared.length === 0) continue;

      const dice =
        (2 * shared.length) / (cTokens.length + mEntry.tokens.length);
      const score = shared.length + dice;

      // Require either >= 2 shared tokens, or 1 strong token with Dice >= 0.4
      if (shared.length < 2 && dice < 0.4) continue;

      const bothHaveWeight =
        c.lastPricePerKgOrL !== null &&
        mEntry.product.lastPricePerKgOrL !== null &&
        c.unitType === mEntry.product.unitType;

      const recommendedMode: CompareMode = bothHaveWeight
        ? "per_kg_or_l"
        : "unit";

      if (!best || score > best.score) {
        best = {
          suggestedName: formatSuggestedName(mEntry.product.rawLabel),
          recommendedMode,
          score: Math.round(score * 100) / 100,
          sharedTokens: shared,
          carrefourProduct: c,
          monoprixProduct: mEntry.product,
        };
      }
    }

    if (best) {
      candidates.push(best);
    }
  }

  // Deduplicate if two Carrefour items point to the same Monoprix item (keep highest score)
  const bestByMonoprix = new Map<string, SuggestedComparisonMatch>();
  for (const cand of candidates.sort((a, b) => b.score - a.score)) {
    if (!bestByMonoprix.has(cand.monoprixProduct.rawLabel)) {
      bestByMonoprix.set(cand.monoprixProduct.rawLabel, cand);
    }
  }

  return Array.from(bestByMonoprix.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

export async function createComparison(input: {
  name: string;
  compareMode?: CompareMode;
  notes?: string | null;
  carrefourLabels: string[];
  monoprixLabels: string[];
}): Promise<number> {
  const db = await ensureDbInitialized();
  const compareMode: CompareMode =
    input.compareMode === "per_kg_or_l" ? "per_kg_or_l" : "unit";

  const inserted = await db
    .insert(productComparisons)
    .values({
      name: input.name.trim(),
      compareMode,
      notes: input.notes?.trim() || null,
    })
    .returning({ id: productComparisons.id });

  const comparisonId = inserted[0].id;
  const links: Array<{
    comparisonId: number;
    retailer: Retailer;
    rawLabel: string;
  }> = [];

  for (const lbl of new Set(input.carrefourLabels.map((s) => s.trim()).filter(Boolean))) {
    links.push({ comparisonId, retailer: "carrefour", rawLabel: lbl });
  }
  for (const lbl of new Set(input.monoprixLabels.map((s) => s.trim()).filter(Boolean))) {
    links.push({ comparisonId, retailer: "monoprix", rawLabel: lbl });
  }

  if (links.length > 0) {
    await db.insert(productComparisonLinks).values(links).onConflictDoNothing();
  }

  return comparisonId;
}

export async function updateComparison(
  id: number,
  input: {
    name?: string;
    compareMode?: CompareMode;
    notes?: string | null;
    carrefourLabels?: string[];
    monoprixLabels?: string[];
  }
): Promise<boolean> {
  const db = await ensureDbInitialized();

  const existing = await db
    .select({ id: productComparisons.id })
    .from(productComparisons)
    .where(eq(productComparisons.id, id))
    .limit(1);

  if (existing.length === 0) return false;

  const updates: {
    name?: string;
    compareMode?: string;
    notes?: string | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (input.name !== undefined && input.name.trim()) {
    updates.name = input.name.trim();
  }
  if (input.compareMode !== undefined) {
    updates.compareMode =
      input.compareMode === "per_kg_or_l" ? "per_kg_or_l" : "unit";
  }
  if (input.notes !== undefined) {
    updates.notes = input.notes?.trim() || null;
  }

  await db
    .update(productComparisons)
    .set(updates)
    .where(eq(productComparisons.id, id));

  if (
    input.carrefourLabels !== undefined ||
    input.monoprixLabels !== undefined
  ) {
    const existingLinks = await db
      .select()
      .from(productComparisonLinks)
      .where(eq(productComparisonLinks.comparisonId, id));

    const nextCarrefour =
      input.carrefourLabels ??
      existingLinks
        .filter((l) => l.retailer === "carrefour")
        .map((l) => l.rawLabel);
    const nextMonoprix =
      input.monoprixLabels ??
      existingLinks
        .filter((l) => l.retailer === "monoprix")
        .map((l) => l.rawLabel);

    await db
      .delete(productComparisonLinks)
      .where(eq(productComparisonLinks.comparisonId, id));

    const newLinks: Array<{
      comparisonId: number;
      retailer: Retailer;
      rawLabel: string;
    }> = [];
    for (const lbl of new Set(nextCarrefour.map((s) => s.trim()).filter(Boolean))) {
      newLinks.push({ comparisonId: id, retailer: "carrefour", rawLabel: lbl });
    }
    for (const lbl of new Set(nextMonoprix.map((s) => s.trim()).filter(Boolean))) {
      newLinks.push({ comparisonId: id, retailer: "monoprix", rawLabel: lbl });
    }

    if (newLinks.length > 0) {
      await db
        .insert(productComparisonLinks)
        .values(newLinks)
        .onConflictDoNothing();
    }
  }

  return true;
}

export async function deleteComparison(id: number): Promise<boolean> {
  const db = await ensureDbInitialized();
  const deleted = await db
    .delete(productComparisons)
    .where(eq(productComparisons.id, id))
    .returning({ id: productComparisons.id });
  return deleted.length > 0;
}

export async function listDismissedSuggestionKeys(): Promise<Set<string>> {
  const db = await ensureDbInitialized();
  const rows = await db.select().from(dismissedComparisonSuggestions);
  return new Set(rows.map((r) => `${r.carrefourLabel}::${r.monoprixLabel}`));
}

export async function dismissSuggestion(
  carrefourLabel: string,
  monoprixLabel: string
): Promise<void> {
  const db = await ensureDbInitialized();
  await db
    .insert(dismissedComparisonSuggestions)
    .values({
      carrefourLabel: carrefourLabel.trim(),
      monoprixLabel: monoprixLabel.trim(),
    })
    .onConflictDoNothing();
}

export async function undismissSuggestion(
  carrefourLabel: string,
  monoprixLabel: string
): Promise<void> {
  const db = await ensureDbInitialized();
  await db
    .delete(dismissedComparisonSuggestions)
    .where(
      and(
        eq(
          dismissedComparisonSuggestions.carrefourLabel,
          carrefourLabel.trim()
        ),
        eq(dismissedComparisonSuggestions.monoprixLabel, monoprixLabel.trim())
      )
    );
}
