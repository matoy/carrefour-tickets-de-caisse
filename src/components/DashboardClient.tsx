"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Upload,
  ShoppingCart,
  Receipt as ReceiptIcon,
  TrendingDown,
  TrendingUp,
  Award,
  Database,
  ChevronDown,
  ChevronUp,
  Store,
  Calendar,
  LogOut,
  Pencil,
  Check,
  X,
  Scale,
  Tag,
  Lock,
  Swords,
  Percent,
} from "lucide-react";
import type {
  AggregatedProduct,
  ReceiptListItem,
  ReceiptStatsSummary,
} from "@/lib/db/receipt-service";
import type {
  ProductComparisonView,
  SuggestedComparisonMatch,
} from "@/lib/db/comparison-service";
import { stripAccents } from "@/lib/parser/normalize";
import {
  DEFAULT_TIME_PERIOD,
  TIME_PERIOD_OPTIONS,
  type TimePeriod,
} from "@/lib/period";
import { SyncModal } from "./SyncModal";
import { BackupModal } from "./BackupModal";
import { ReceiptDetailModal } from "./ReceiptDetailModal";
import { DuelComparisonTab } from "./DuelComparisonTab";

interface DashboardClientProps {
  initialReceipts: ReceiptListItem[];
  initialStats: ReceiptStatsSummary;
  initialProducts: AggregatedProduct[];
  initialComparisons: ProductComparisonView[];
  initialSuggestions: SuggestedComparisonMatch[];
  initialPeriod?: TimePeriod;
  authEnabled: boolean;
  isRemotePostgres: boolean;
}

type MainTab = "duel" | "catalog" | "receipts";
type RetailerFilter = "all" | "carrefour" | "monoprix";
type ProductFilter = "all" | "discounts" | "weighted" | "monoprix";
type ProductSort = "recent" | "name" | "price_asc" | "most_bought" | "savings";
type CompareBasis = "net" | "shelf";

function formatStoreBadge(
  storeName: string,
  retailer: "carrefour" | "monoprix"
): {
  label: string;
  colorClass: string;
} {
  if (retailer === "monoprix") {
    return {
      label: storeName,
      colorClass: "bg-rose-100 text-rose-800 border-rose-300",
    };
  }
  if (/city/i.test(storeName)) {
    return {
      label: storeName.replace(/_/g, " "),
      colorClass: "bg-lime-100 text-lime-800 border-lime-300",
    };
  }
  if (/market/i.test(storeName)) {
    return {
      label: storeName.replace(/_/g, " "),
      colorClass: "bg-blue-100 text-blue-800 border-blue-300",
    };
  }
  return {
    label: storeName,
    colorClass: "bg-blue-100 text-blue-800 border-blue-300",
  };
}

export function DashboardClient({
  initialReceipts,
  initialStats,
  initialProducts,
  initialComparisons,
  initialSuggestions,
  initialPeriod = DEFAULT_TIME_PERIOD,
  authEnabled,
  isRemotePostgres,
}: DashboardClientProps) {
  const router = useRouter();
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(initialPeriod);
  const fetchSeqRef = useRef(0);
  const [receiptsList, setReceiptsList] =
    useState<ReceiptListItem[]>(initialReceipts);
  const [stats, setStats] = useState<ReceiptStatsSummary>(initialStats);
  const [products, setProducts] =
    useState<AggregatedProduct[]>(initialProducts);
  const [comparisons, setComparisons] =
    useState<ProductComparisonView[]>(initialComparisons);
  const [suggestions, setSuggestions] =
    useState<SuggestedComparisonMatch[]>(initialSuggestions);

  const [activeTab, setActiveTab] = useState<MainTab>("catalog");
  const [searchQuery, setSearchQuery] = useState("");
  const [retailerFilter, setRetailerFilter] = useState<RetailerFilter>("all");
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [productSort, setProductSort] = useState<ProductSort>("recent");
  const [compareBasis, setCompareBasis] = useState<CompareBasis>("net");
  const [storeFilter, setStoreFilter] = useState<string>("all");

  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [editingNameFor, setEditingNameFor] = useState<string | null>(null);
  const [customNameDraft, setCustomNameDraft] = useState("");
  const [monoprixDrafts, setMonoprixDrafts] = useState<Record<string, string>>(
    () => {
      const map: Record<string, string> = {};
      for (const p of initialProducts) {
        if (p.retailer === "carrefour" && p.monoprixPrice !== null) {
          map[p.rawLabel] = p.monoprixPrice.toFixed(2);
        }
      }
      return map;
    }
  );
  const [savingNoteFor, setSavingNoteFor] = useState<string | null>(null);
  const [preselectedForDuel, setPreselectedForDuel] =
    useState<AggregatedProduct | null>(null);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] =
    useState<ReceiptListItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshAllData(periodOverride?: TimePeriod) {
    const targetPeriod = periodOverride ?? timePeriod;
    const seq = ++fetchSeqRef.current;
    setRefreshing(true);
    try {
      const qs = `period=${encodeURIComponent(targetPeriod)}`;
      const [recRes, prodRes, compRes] = await Promise.all([
        fetch(`/api/receipts?includeItems=true&${qs}`),
        fetch(`/api/products?${qs}`),
        fetch(`/api/comparisons?${qs}`),
      ]);
      if (seq !== fetchSeqRef.current) return;

      if (recRes.ok) {
        const recData = (await recRes.json()) as {
          receipts: ReceiptListItem[];
          stats: ReceiptStatsSummary;
        };
        setReceiptsList(recData.receipts);
        setStats(recData.stats);
      }
      if (prodRes.ok) {
        const prodData = (await prodRes.json()) as {
          products: AggregatedProduct[];
        };
        setProducts(prodData.products);
        setMonoprixDrafts((prev) => {
          const next = { ...prev };
          for (const p of prodData.products) {
            if (
              p.retailer === "carrefour" &&
              p.monoprixPrice !== null &&
              next[p.rawLabel] === undefined
            ) {
              next[p.rawLabel] = p.monoprixPrice.toFixed(2);
            }
          }
          return next;
        });
      }
      if (compRes.ok) {
        const compData = (await compRes.json()) as {
          comparisons: ProductComparisonView[];
          suggestions: SuggestedComparisonMatch[];
        };
        setComparisons(compData.comparisons);
        setSuggestions(compData.suggestions);
      }
    } finally {
      if (seq === fetchSeqRef.current) {
        setRefreshing(false);
      }
    }
  }

  async function refreshComparisonsOnly(periodOverride?: TimePeriod) {
    const targetPeriod = periodOverride ?? timePeriod;
    const compRes = await fetch(
      `/api/comparisons?period=${encodeURIComponent(targetPeriod)}`
    );
    if (compRes.ok) {
      const compData = (await compRes.json()) as {
        comparisons: ProductComparisonView[];
        suggestions: SuggestedComparisonMatch[];
      };
      setComparisons(compData.comparisons);
      setSuggestions(compData.suggestions);
    }
  }

  function handleChangePeriod(nextPeriod: TimePeriod) {
    if (nextPeriod === timePeriod) return;
    setTimePeriod(nextPeriod);
    void refreshAllData(nextPeriod);
  }

  async function saveProductNote(
    rawLabel: string,
    patch: {
      customName?: string | null;
      monoprixPrice?: string | null;
      monoprixUnit?: string | null;
    }
  ) {
    setSavingNoteFor(rawLabel);
    const existing = products.find((p) => p.rawLabel === rawLabel);
    const body = {
      rawLabel,
      customName:
        patch.customName !== undefined
          ? patch.customName
          : existing?.customName ?? null,
      monoprixPrice:
        patch.monoprixPrice !== undefined
          ? patch.monoprixPrice
          : existing?.monoprixPrice !== null &&
            existing?.monoprixPrice !== undefined
          ? String(existing.monoprixPrice)
          : null,
      monoprixUnit:
        patch.monoprixUnit !== undefined
          ? patch.monoprixUnit
          : existing?.monoprixUnit ?? null,
    };

    try {
      const res = await fetch("/api/products/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const saved = (await res.json()) as {
          customName: string | null;
          monoprixPrice: number | null;
          monoprixUnit: string | null;
        };
        setProducts((prev) =>
          prev.map((p) =>
            p.rawLabel === rawLabel
              ? {
                  ...p,
                  customName: saved.customName,
                  monoprixPrice: saved.monoprixPrice,
                  monoprixUnit: saved.monoprixUnit,
                }
              : p
          )
        );
      }
    } finally {
      setSavingNoteFor(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/login", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  function getProductRefPrice(p: AggregatedProduct): {
    price: number;
    unitLabel: string;
  } {
    const usePerKg =
      p.monoprixUnit === "per_kg_or_l" && p.lastPricePerKgOrL !== null;
    if (usePerKg) {
      const price =
        compareBasis === "net" && p.lastNetPricePerKgOrL !== null
          ? p.lastNetPricePerKgOrL
          : p.lastPricePerKgOrL ?? p.lastUnitPrice;
      return {
        price,
        unitLabel: p.unitType === "L" ? "€/L" : "€/kg",
      };
    }

    const price = compareBasis === "net" ? p.lastNetUnitPrice : p.lastUnitPrice;
    return {
      price,
      unitLabel: "€",
    };
  }

  const filteredProducts = useMemo(() => {
    const tokens = stripAccents(searchQuery)
      .split(" ")
      .filter((t) => t.length > 0);

    const list = products.filter((p) => {
      if (retailerFilter !== "all" && p.retailer !== retailerFilter) {
        return false;
      }

      if (tokens.length > 0) {
        const hay = stripAccents(
          `${p.retailer} ${p.rawLabel} ${p.normalizedLabel} ${p.customName ?? ""}`
        );
        if (!tokens.every((t) => hay.includes(t))) return false;
      }

      if (productFilter === "discounts") {
        return p.history.some(
          (h) => h.immediateDiscount > 0 || h.loyaltyDiscount > 0
        );
      }
      if (productFilter === "weighted") {
        return p.lastPricePerKgOrL !== null;
      }
      if (productFilter === "monoprix") {
        return p.retailer === "carrefour" && p.monoprixPrice !== null;
      }
      return true;
    });

    list.sort((a, b) => {
      if (productSort === "name") {
        return (a.customName ?? a.rawLabel).localeCompare(
          b.customName ?? b.rawLabel,
          "fr"
        );
      }
      if (productSort === "price_asc") {
        return getProductRefPrice(a).price - getProductRefPrice(b).price;
      }
      if (productSort === "most_bought") {
        return b.totalQuantity - a.totalQuantity;
      }
      if (productSort === "savings") {
        const savA =
          a.retailer === "carrefour" && a.monoprixPrice !== null
            ? a.monoprixPrice - getProductRefPrice(a).price
            : -9999;
        const savB =
          b.retailer === "carrefour" && b.monoprixPrice !== null
            ? b.monoprixPrice - getProductRefPrice(b).price
            : -9999;
        return savB - savA;
      }
      return (
        new Date(b.lastPurchaseDate).getTime() -
        new Date(a.lastPurchaseDate).getTime()
      );
    });

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    products,
    searchQuery,
    retailerFilter,
    productFilter,
    productSort,
    compareBasis,
  ]);

  const storeOptions = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        label: string;
        retailer: "carrefour" | "monoprix";
        count: number;
      }
    >();

    for (const r of receiptsList) {
      const key = `${r.retailer}::${r.storeName}`;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          key,
          label: r.storeName.replace(/_/g, " "),
          retailer: r.retailer,
          count: 1,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, "fr");
    });
  }, [receiptsList]);

  const activeStoreFilter = useMemo(() => {
    if (storeFilter === "all") return "all";
    return storeOptions.some((o) => o.key === storeFilter)
      ? storeFilter
      : "all";
  }, [storeFilter, storeOptions]);

  const filteredReceipts = useMemo(() => {
    if (activeStoreFilter === "all") return receiptsList;
    return receiptsList.filter(
      (r) => `${r.retailer}::${r.storeName}` === activeStoreFilter
    );
  }, [receiptsList, activeStoreFilter]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Navbar — ultra compact on mobile */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 sm:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg sm:rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-rose-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <ShoppingCart className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-lg font-bold tracking-tight text-slate-900 truncate">
                  <span className="sm:hidden">Mes Courses</span>
                  <span className="hidden sm:inline">
                    Mes Courses — Carrefour vs Monoprix
                  </span>
                </h1>
                <span
                  className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                    isRemotePostgres
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                  }`}
                >
                  <Database className="h-3 w-3" />
                  {isRemotePostgres ? "PostgreSQL Neon" : "PostgreSQL Local"}
                </span>
                {authEnabled && (
                  <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    <Lock className="h-3 w-3" />
                    Protégé
                  </span>
                )}
              </div>
              <p className="hidden sm:block text-xs text-slate-500">
                Comparez vos prix nets réels (-10% Club Carrefour & -10% remise
                M+) sur tous vos achats PDF
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setBackupModalOpen(true)}
              title="Exporter / Importer la sauvegarde BDD (.json.gz)"
              aria-label="Sauvegarde BDD"
              className="inline-flex items-center gap-1.5 sm:gap-2 p-2 sm:px-3.5 sm:py-2.5 rounded-lg sm:rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs sm:text-sm font-semibold shadow-2xs transition cursor-pointer"
            >
              <Database className="h-4 w-4 text-indigo-600" />
              <span className="hidden sm:inline">Sauvegarde</span>
            </button>

            <button
              type="button"
              onClick={() => setSyncModalOpen(true)}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold shadow-sm transition cursor-pointer"
            >
              <Upload
                className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${refreshing ? "animate-pulse" : ""}`}
              />
              <span className="sm:hidden">Importer</span>
              <span className="hidden sm:inline">Importer des PDF</span>
            </button>

            {authEnabled && (
              <button
                type="button"
                onClick={handleLogout}
                title="Se déconnecter"
                className="p-2 sm:p-2.5 rounded-lg sm:rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-6 pb-24 md:pb-6 space-y-4 sm:space-y-6">
        {/* Global Time Period Filter (KPIs + Search/Catalog + Duels + Receipts) */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <Calendar className="h-3.5 w-3.5 text-blue-600" />
            <span>Période</span>
            {refreshing && (
              <span className="text-[11px] font-normal text-slate-400">
                · Mise à jour...
              </span>
            )}
          </div>
          <div
            role="group"
            aria-label="Filtrer par période"
            className="inline-flex items-center rounded-xl bg-white border border-slate-200 p-0.5 shadow-2xs"
          >
            {TIME_PERIOD_OPTIONS.map((opt) => {
              const active = timePeriod === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleChangePeriod(opt.value)}
                  aria-pressed={active}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
                    active
                      ? "bg-blue-600 text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  <span className="sm:hidden">{opt.shortLabel}</span>
                  <span className="hidden sm:inline">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* KPI Cards — horizontal swipe strip on mobile, 2/4-col grid on desktop */}
        <section
          className={`flex overflow-x-auto no-scrollbar snap-x gap-2.5 -mx-3 px-3 pb-1 sm:mx-0 sm:px-0 sm:pb-0 sm:grid sm:grid-cols-2 lg:grid-cols-4 sm:gap-4 sm:overflow-visible transition-opacity ${
            refreshing ? "opacity-70" : "opacity-100"
          }`}
        >
          <div className="min-w-[146px] sm:min-w-0 snap-start shrink-0 bg-white rounded-xl sm:rounded-2xl border border-slate-200 p-2.5 sm:p-4 shadow-2xs">
            <div className="text-[11px] sm:text-xs font-medium text-slate-500 flex items-center justify-between gap-2">
              <span>Documents</span>
              <ReceiptIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-600 shrink-0" />
            </div>
            <div className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5 sm:mt-1">
              {stats.totalReceipts}
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5 whitespace-nowrap">
              {stats.carrefourCount} CRF · {stats.monoprixCount} MNP
            </div>
          </div>

          <div className="min-w-[152px] sm:min-w-0 snap-start shrink-0 bg-white rounded-xl sm:rounded-2xl border border-slate-200 p-2.5 sm:p-4 shadow-2xs">
            <div className="text-[11px] sm:text-xs font-medium text-slate-500 flex items-center justify-between gap-2">
              <span>Produits & Duels</span>
              <Swords className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-indigo-600 shrink-0" />
            </div>
            <div className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5 sm:mt-1">
              {products.length}
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5 whitespace-nowrap">
              {comparisons.length} duel(s) · {suggestions.length} sugg.
            </div>
          </div>

          <div className="min-w-[156px] sm:min-w-0 snap-start shrink-0 bg-white rounded-xl sm:rounded-2xl border border-slate-200 p-2.5 sm:p-4 shadow-2xs">
            <div className="text-[11px] sm:text-xs font-medium text-slate-500 flex items-center justify-between gap-2">
              <span>Total dépensé</span>
              <ShoppingCart className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-600 shrink-0" />
            </div>
            <div className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5 sm:mt-1">
              {stats.totalSpent.toFixed(2)} €
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5 whitespace-nowrap">
              {stats.carrefourSpent.toFixed(0)} € CRF ·{" "}
              {stats.monoprixSpent.toFixed(0)} € MNP
            </div>
          </div>

          <div className="min-w-[168px] sm:min-w-0 snap-start shrink-0 bg-white rounded-xl sm:rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white p-2.5 sm:p-4 shadow-2xs">
            <div className="text-[11px] sm:text-xs font-medium text-emerald-800 flex items-center justify-between gap-2">
              <span>Économies</span>
              <Award className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-600 shrink-0" />
            </div>
            <div className="text-lg sm:text-2xl font-bold text-emerald-700 mt-0.5 sm:mt-1">
              {stats.totalSaved.toFixed(2)} €
            </div>
            <div className="text-[11px] sm:text-xs text-emerald-700/80 mt-0.5 whitespace-nowrap">
              {stats.totalImmediateSaved.toFixed(2)} +{" "}
              {stats.totalGlobalDiscount.toFixed(2)} M+ ·{" "}
              {stats.totalLoyaltySaved.toFixed(2)} Club
            </div>
          </div>
        </section>

        {/* Desktop Tabs (hidden on mobile where bottom nav bar is used) */}
        <div className="hidden md:flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("catalog")}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                activeTab === "catalog"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Search className="h-4 w-4" />
              <span>Catalogue & Recherche ({products.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("duel")}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                activeTab === "duel"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Swords className="h-4 w-4" />
              <span>
                Duel Carrefour vs Monoprix ({comparisons.length})
              </span>
              {suggestions.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800">
                  +{suggestions.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("receipts")}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                activeTab === "receipts"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <ReceiptIcon className="h-4 w-4" />
              <span>Mes Tickets & Factures ({receiptsList.length})</span>
            </button>
          </div>
        </div>

        {/* TAB 1: Duel Carrefour vs Monoprix */}
        {activeTab === "duel" && (
          <DuelComparisonTab
            comparisons={comparisons}
            suggestions={suggestions}
            products={products}
            compareBasis={compareBasis}
            onChangeCompareBasis={setCompareBasis}
            preselectedProduct={preselectedForDuel}
            onClearPreselected={() => setPreselectedForDuel(null)}
            onComparisonsChanged={() => {
              void refreshComparisonsOnly();
            }}
          />
        )}

        {/* TAB 2: Unified Catalog */}
        {activeTab === "catalog" && (
          <section className="space-y-3 sm:space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 shadow-2xs space-y-2.5 sm:space-y-3">
              <div className="flex flex-col md:flex-row gap-2.5 sm:gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher un produit (sucrine, lait, comté...)"
                    className="w-full pl-10 sm:pl-11 pr-9 py-2 sm:py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-base sm:text-sm"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <select
                    value={productSort}
                    onChange={(e) =>
                      setProductSort(e.target.value as ProductSort)
                    }
                    className="flex-1 sm:flex-none px-3 py-2 sm:py-2.5 rounded-xl border border-slate-300 text-base sm:text-sm bg-white text-slate-700 outline-none focus:border-blue-500"
                  >
                    <option value="recent">Tri : Plus récent</option>
                    <option value="name">Tri : Nom A-Z</option>
                    <option value="price_asc">Tri : Prix croissant</option>
                    <option value="most_bought">Tri : Plus achetés</option>
                    <option value="savings">Tri : Gain manuel Monoprix</option>
                  </select>

                  <div className="inline-flex rounded-xl border border-slate-300 p-0.5 bg-slate-50 text-xs font-medium shrink-0">
                    <button
                      type="button"
                      onClick={() => setCompareBasis("net")}
                      className={`px-2.5 py-1.5 rounded-lg cursor-pointer transition ${
                        compareBasis === "net"
                          ? "bg-emerald-600 text-white shadow-2xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Prix net
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareBasis("shelf")}
                      className={`px-2.5 py-1.5 rounded-lg cursor-pointer transition ${
                        compareBasis === "shelf"
                          ? "bg-slate-800 text-white shadow-2xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Affiché
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-0.5">
                <div className="flex overflow-x-auto no-scrollbar flex-nowrap sm:flex-wrap items-center gap-1.5 text-xs -mx-1 px-1 pb-0.5">
                  {(
                    [
                      ["all", "Toutes"],
                      ["carrefour", "Carrefour"],
                      ["monoprix", "Monoprix"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRetailerFilter(key)}
                      className={`px-3 py-1.5 rounded-full font-semibold transition cursor-pointer shrink-0 ${
                        retailerFilter === key
                          ? key === "monoprix"
                            ? "bg-rose-600 text-white"
                            : key === "carrefour"
                            ? "bg-blue-600 text-white"
                            : "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}

                  <span className="hidden sm:inline text-slate-300 px-1">|</span>

                  {(
                    [
                      ["all", "Tous produits"],
                      ["weighted", "Au kg / L"],
                      ["discounts", "Promos / M+ / Club"],
                      ["monoprix", "Prix Monop saisi"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setProductFilter(key)}
                      className={`px-3 py-1.5 rounded-full font-medium transition cursor-pointer shrink-0 ${
                        productFilter === key
                          ? "bg-blue-100 text-blue-800 border border-blue-300"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <span className="text-[11px] sm:text-xs text-slate-500 shrink-0">
                  {filteredProducts.length} produit(s)
                </span>
              </div>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
                Aucun produit ne correspond à votre recherche.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredProducts.map((p) => {
                  const isExpanded = expandedProduct === p.key;
                  const isMonoprix = p.retailer === "monoprix";
                  const ref = getProductRefPrice(p);
                  const draftValue = monoprixDrafts[p.rawLabel] ?? "";
                  const numericManualMonoprix =
                    draftValue.trim() !== ""
                      ? Number(draftValue.replace(",", "."))
                      : p.monoprixPrice;
                  const validManualMonoprix =
                    !isMonoprix &&
                    numericManualMonoprix !== null &&
                    Number.isFinite(numericManualMonoprix) &&
                    numericManualMonoprix > 0
                      ? numericManualMonoprix
                      : null;

                  const manualDiff =
                    validManualMonoprix !== null
                      ? validManualMonoprix - ref.price
                      : null;

                  const hasSavingsVsShelf = p.lastNetUnitPrice < p.lastUnitPrice;

                  return (
                    <div
                      key={p.key}
                      className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden transition hover:border-slate-300"
                    >
                      <div className="p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                isMonoprix
                                  ? "bg-rose-100 text-rose-800 border-rose-200"
                                  : "bg-blue-100 text-blue-800 border-blue-200"
                              }`}
                            >
                              {isMonoprix ? "Monoprix" : "Carrefour"}
                            </span>

                            {editingNameFor === p.key ? (
                              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                                <input
                                  type="text"
                                  value={customNameDraft}
                                  onChange={(e) =>
                                    setCustomNameDraft(e.target.value)
                                  }
                                  placeholder={p.rawLabel}
                                  autoFocus
                                  className="flex-1 sm:flex-none px-2.5 py-1 rounded-lg border border-blue-400 text-base sm:text-sm font-semibold outline-none"
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      void saveProductNote(p.rawLabel, {
                                        customName: customNameDraft || null,
                                      });
                                      setEditingNameFor(null);
                                    }
                                    if (e.key === "Escape") {
                                      setEditingNameFor(null);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    void saveProductNote(p.rawLabel, {
                                      customName: customNameDraft || null,
                                    });
                                    setEditingNameFor(null);
                                  }}
                                  className="p-1 rounded-lg bg-emerald-600 text-white cursor-pointer"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingNameFor(null)}
                                  className="p-1 rounded-lg bg-slate-200 text-slate-700 cursor-pointer"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <h3 className="text-base font-bold text-slate-900">
                                  {p.customName ?? p.rawLabel}
                                </h3>
                                <button
                                  type="button"
                                  title="Renommer pour faciliter la recherche"
                                  onClick={() => {
                                    setEditingNameFor(p.key);
                                    setCustomNameDraft(p.customName ?? "");
                                  }}
                                  className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}

                            {p.priceTrendPct !== null &&
                              p.priceTrendPct !== 0 && (
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                    p.priceTrendPct < 0
                                      ? "bg-emerald-100 text-emerald-800"
                                      : "bg-amber-100 text-amber-800"
                                  }`}
                                >
                                  {p.priceTrendPct < 0 ? (
                                    <TrendingDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <TrendingUp className="h-3.5 w-3.5" />
                                  )}
                                  {p.priceTrendPct > 0 ? "+" : ""}
                                  {p.priceTrendPct}% vs 1er achat
                                </span>
                              )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                            {p.customName && (
                              <span className="font-mono text-slate-400">
                                Libellé : {p.rawLabel}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              Dernier achat :{" "}
                              {new Date(p.lastPurchaseDate).toLocaleDateString(
                                "fr-FR"
                              )}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Store className="h-3.5 w-3.5" />
                              {p.lastStoreName.replace(/_/g, " ")}
                            </span>
                            <span>
                              Acheté {p.purchaseCount}× (qté totale{" "}
                              {p.totalQuantity})
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                          <div>
                            <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                              Dernier prix
                            </div>
                            <div className="flex items-baseline gap-2">
                              <span
                                className={`text-lg font-bold ${
                                  compareBasis === "net" && hasSavingsVsShelf
                                    ? "text-emerald-700"
                                    : "text-slate-900"
                                }`}
                              >
                                {compareBasis === "net"
                                  ? `${p.lastNetUnitPrice.toFixed(2)} €`
                                  : `${p.lastUnitPrice.toFixed(2)} €`}
                              </span>
                              {hasSavingsVsShelf && (
                                <span
                                  className="text-xs text-slate-400 line-through"
                                  title="Prix affiché avant remise/abonnement"
                                >
                                  {p.lastUnitPrice.toFixed(2)} €
                                </span>
                              )}
                            </div>
                            {hasSavingsVsShelf && (
                              <div className="text-[11px] text-emerald-700 font-medium">
                                {isMonoprix
                                  ? "Net après promo / -10% M+"
                                  : "Net après remise / Club"}
                              </div>
                            )}
                          </div>

                          {p.lastPricePerKgOrL !== null && (
                            <div>
                              <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold flex items-center gap-1">
                                <Scale className="h-3 w-3" />
                                Au {p.unitType === "L" ? "Litre" : "Kilo"}
                              </div>
                              <div className="text-base font-bold text-blue-700">
                                {(compareBasis === "net" &&
                                p.lastNetPricePerKgOrL !== null
                                  ? p.lastNetPricePerKgOrL
                                  : p.lastPricePerKgOrL
                                ).toFixed(2)}{" "}
                                €/{p.unitType === "L" ? "L" : "kg"}
                              </div>
                              {p.minPricePerKgOrL !== null &&
                                p.maxPricePerKgOrL !== null &&
                                p.minPricePerKgOrL !== p.maxPricePerKgOrL && (
                                  <div className="text-[11px] text-slate-500">
                                    Min {p.minPricePerKgOrL.toFixed(2)} · Max{" "}
                                    {p.maxPricePerKgOrL.toFixed(2)}
                                  </div>
                                )}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                          {!isMonoprix && (
                            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                              <span className="text-xs font-semibold text-slate-600">
                                Prix Monop :
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={draftValue}
                                onChange={(e) =>
                                  setMonoprixDrafts((prev) => ({
                                    ...prev,
                                    [p.rawLabel]: e.target.value,
                                  }))
                                }
                                onBlur={() => {
                                  const cur =
                                    p.monoprixPrice !== null
                                      ? p.monoprixPrice.toFixed(2)
                                      : "";
                                  if (draftValue !== cur) {
                                    void saveProductNote(p.rawLabel, {
                                      monoprixPrice: draftValue || null,
                                    });
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    void saveProductNote(p.rawLabel, {
                                      monoprixPrice: draftValue || null,
                                    });
                                  }
                                }}
                                placeholder="0.00"
                                className="w-20 sm:w-16 px-2 sm:px-1.5 py-1 sm:py-0.5 rounded-md border border-slate-300 bg-white text-base sm:text-xs font-semibold text-right outline-none focus:border-blue-500"
                              />
                              {p.lastPricePerKgOrL !== null ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextUnit =
                                      p.monoprixUnit === "per_kg_or_l"
                                        ? "unit"
                                        : "per_kg_or_l";
                                    void saveProductNote(p.rawLabel, {
                                      monoprixUnit: nextUnit,
                                    });
                                  }}
                                  className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 cursor-pointer"
                                >
                                  {p.monoprixUnit === "per_kg_or_l"
                                    ? p.unitType === "L"
                                      ? "€/L"
                                      : "€/kg"
                                    : "€"}
                                </button>
                              ) : (
                                <span className="text-xs text-slate-500">€</span>
                              )}
                            </div>
                          )}

                          {manualDiff !== null && (
                            <span
                              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap ${
                                manualDiff > 0.005
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                  : manualDiff < -0.005
                                  ? "bg-rose-100 text-rose-800 border border-rose-200"
                                  : "bg-slate-100 text-slate-700 border border-slate-200"
                              }`}
                            >
                              {manualDiff > 0.005
                                ? `Carrefour -${manualDiff.toFixed(2)} ${ref.unitLabel}`
                                : manualDiff < -0.005
                                ? `Monoprix -${Math.abs(manualDiff).toFixed(2)} ${ref.unitLabel}`
                                : "Prix égal"}
                            </span>
                          )}

                          {savingNoteFor === p.rawLabel && (
                            <span className="text-[11px] text-slate-400">
                              ...
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setPreselectedForDuel(p);
                              setActiveTab("duel");
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-xs font-semibold text-indigo-700 cursor-pointer"
                          >
                            <Swords className="h-3.5 w-3.5" />
                            <span>Duel</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedProduct(isExpanded ? null : p.key)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer"
                          >
                            <span>Historique</span>
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="text-slate-500 uppercase tracking-wide border-b border-slate-200">
                              <tr>
                                <th className="text-left py-1.5 pr-3">Date</th>
                                <th className="text-left py-1.5 pr-3">
                                  Magasin / Enseigne
                                </th>
                                <th className="text-right py-1.5 px-3">Qté</th>
                                <th className="text-right py-1.5 px-3">
                                  P.U. affiché
                                </th>
                                <th className="text-right py-1.5 px-3">
                                  {isMonoprix ? "Promos / M+" : "Remises / Club"}
                                </th>
                                <th className="text-right py-1.5 px-3">
                                  Net unitaire
                                </th>
                                <th className="text-right py-1.5 pl-3">
                                  Prix / kg ou L
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/60">
                              {p.history.map((h, idx) => {
                                const totalDisc =
                                  h.immediateDiscount + h.loyaltyDiscount;
                                return (
                                  <tr key={`${h.receiptId}-${idx}`}>
                                    <td className="py-2 pr-3 font-medium text-slate-800 whitespace-nowrap">
                                      {new Date(
                                        h.purchaseDate
                                      ).toLocaleDateString("fr-FR")}{" "}
                                      <span className="text-slate-400 font-normal">
                                        (#{h.ticketKey})
                                      </span>
                                    </td>
                                    <td className="py-2 pr-3 text-slate-600">
                                      {h.storeName.replace(/_/g, " ")}
                                    </td>
                                    <td className="py-2 px-3 text-right text-slate-700">
                                      {h.quantity}
                                      {h.weightKg !== null
                                        ? ` (${h.weightKg} kg)`
                                        : h.volumeL !== null
                                        ? ` (${h.volumeL} L)`
                                        : ""}
                                    </td>
                                    <td className="py-2 px-3 text-right font-medium text-slate-800">
                                      {h.unitPrice.toFixed(2)} €
                                    </td>
                                    <td className="py-2 px-3 text-right text-emerald-700">
                                      {totalDisc > 0
                                        ? `-${totalDisc.toFixed(2)} €`
                                        : "—"}
                                    </td>
                                    <td className="py-2 px-3 text-right font-bold text-emerald-700">
                                      {h.netUnitPrice.toFixed(2)} €
                                    </td>
                                    <td className="py-2 pl-3 text-right text-blue-700 font-medium">
                                      {h.pricePerKgOrL !== null
                                        ? `${h.pricePerKgOrL.toFixed(2)} €/${
                                            h.unitType === "L" ? "L" : "kg"
                                          }`
                                        : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: Receipts & Invoices */}
        {activeTab === "receipts" && (
          <section className="space-y-3 sm:space-y-4">
            <div className="flex overflow-x-auto no-scrollbar flex-nowrap sm:flex-wrap items-center gap-1.5 sm:gap-2 text-xs -mx-1 px-1 pb-0.5">
              <button
                type="button"
                onClick={() => setStoreFilter("all")}
                className={`px-3 py-1.5 rounded-full font-medium transition cursor-pointer shrink-0 ${
                  activeStoreFilter === "all"
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                Tous ({receiptsList.length})
              </button>
              {storeOptions.map((opt) => {
                const isSelected = activeStoreFilter === opt.key;
                const activeClass =
                  opt.retailer === "monoprix"
                    ? "bg-rose-600 text-white"
                    : /city/i.test(opt.label)
                    ? "bg-lime-600 text-white"
                    : "bg-blue-600 text-white";
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setStoreFilter(opt.key)}
                    className={`px-3 py-1.5 rounded-full font-medium transition cursor-pointer shrink-0 ${
                      isSelected
                        ? activeClass
                        : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {opt.label} ({opt.count})
                  </button>
                );
              })}
            </div>

            {filteredReceipts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
                Aucun document trouvé. Cliquez sur{" "}
                <strong>Importer des PDF</strong> pour ajouter vos tickets
                Carrefour ou factures Monoprix.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredReceipts.map((r) => {
                  const badge = formatStoreBadge(r.storeName, r.retailer);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedReceipt(r)}
                      className="text-left bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs hover:border-blue-400 hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-4"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${badge.colorClass}`}
                          >
                            {badge.label}
                          </span>
                          <span className="text-xs font-mono text-slate-400">
                            #{r.ticketKey}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                          <Calendar className="h-4 w-4 text-slate-400" />
                          <span>
                            {new Date(r.purchaseDate).toLocaleString("fr-FR", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </span>
                        </div>

                        <div className="text-xs text-slate-500">
                          {r.itemCount} article{r.itemCount > 1 ? "s" : ""}
                          {r.paymentMethod ? ` · ${r.paymentMethod}` : ""}
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-end justify-between">
                        <div className="space-y-0.5 text-xs">
                          {r.totalImmediateDiscount > 0 && (
                            <div className="text-rose-700 font-medium flex items-center gap-1">
                              <Tag className="h-3 w-3" />
                              Promos : -{r.totalImmediateDiscount.toFixed(2)} €
                            </div>
                          )}
                          {r.globalDiscount > 0 && (
                            <div className="text-emerald-700 font-medium flex items-center gap-1">
                              <Percent className="h-3 w-3" />
                              Remise M+ : -{r.globalDiscount.toFixed(2)} €
                            </div>
                          )}
                          {r.loyaltyCredited > 0 && (
                            <div className="text-emerald-700 font-medium flex items-center gap-1">
                              <Award className="h-3.5 w-3.5" />+
                              {r.loyaltyCredited.toFixed(2)} € Club Carrefour
                            </div>
                          )}
                          {r.totalImmediateDiscount === 0 &&
                            r.globalDiscount === 0 &&
                            r.loyaltyCredited === 0 && (
                              <span className="text-slate-400">
                                Voir le détail →
                              </span>
                            )}
                        </div>

                        <div className="text-xl font-bold text-slate-900">
                          {r.totalPaid.toFixed(2)} €
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Navigation principale"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.06)]"
      >
        <div className="grid grid-cols-3 h-14">
          <button
            type="button"
            onClick={() => setActiveTab("catalog")}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition cursor-pointer ${
              activeTab === "catalog"
                ? "text-blue-600"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Search className="h-5 w-5" />
            <span>Catalogue ({products.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("duel")}
            className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition cursor-pointer ${
              activeTab === "duel"
                ? "text-blue-600"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <div className="relative">
              <Swords className="h-5 w-5" />
              {suggestions.length > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {suggestions.length}
                </span>
              )}
            </div>
            <span>Duels ({comparisons.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("receipts")}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition cursor-pointer ${
              activeTab === "receipts"
                ? "text-blue-600"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <ReceiptIcon className="h-5 w-5" />
            <span>Tickets ({receiptsList.length})</span>
          </button>
        </div>
      </nav>

      {/* Modals */}
      <SyncModal
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        onSyncSuccess={() => {
          void refreshAllData();
        }}
        lastSyncAt={stats.lastSyncAt}
      />

      <BackupModal
        open={backupModalOpen}
        onClose={() => setBackupModalOpen(false)}
        onImportSuccess={() => {
          void refreshAllData();
        }}
      />

      <ReceiptDetailModal
        receipt={selectedReceipt}
        onClose={() => setSelectedReceipt(null)}
        onDeleted={() => {
          void refreshAllData();
        }}
      />
    </div>
  );
}
