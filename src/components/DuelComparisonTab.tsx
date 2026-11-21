"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Sparkles,
  Scale,
  Trash2,
  Pencil,
  Check,
  X,
  Search,
  ArrowRightLeft,
  Trophy,
} from "lucide-react";
import type { AggregatedProduct } from "@/lib/db/receipt-service";
import type {
  CompareMode,
  ProductComparisonView,
  SuggestedComparisonMatch,
} from "@/lib/db/comparison-service";
import { stripAccents } from "@/lib/parser/normalize";

interface DuelComparisonTabProps {
  comparisons: ProductComparisonView[];
  suggestions: SuggestedComparisonMatch[];
  products: AggregatedProduct[];
  compareBasis: "net" | "shelf";
  onChangeCompareBasis: (basis: "net" | "shelf") => void;
  preselectedProduct?: AggregatedProduct | null;
  onClearPreselected?: () => void;
  onComparisonsChanged: () => void;
}

type WinnerFilter = "all" | "carrefour" | "monoprix" | "incomplete";
type DuelSort = "savings_pct" | "savings_abs" | "name";

export function DuelComparisonTab({
  comparisons,
  suggestions,
  products,
  compareBasis,
  onChangeCompareBasis,
  preselectedProduct,
  onClearPreselected,
  onComparisonsChanged,
}: DuelComparisonTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [winnerFilter, setWinnerFilter] = useState<WinnerFilter>("all");
  const [duelSort, setDuelSort] = useState<DuelSort>("savings_pct");

  // Create / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [duelName, setDuelName] = useState("");
  const [duelMode, setDuelMode] = useState<CompareMode>("unit");
  const [carrefourSearch, setCarrefourSearch] = useState("");
  const [monoprixSearch, setMonoprixSearch] = useState("");
  const [selectedCarrefour, setSelectedCarrefour] = useState<string[]>([]);
  const [selectedMonoprix, setSelectedMonoprix] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  const carrefourProducts = useMemo(
    () => products.filter((p) => p.retailer === "carrefour"),
    [products]
  );
  const monoprixProducts = useMemo(
    () => products.filter((p) => p.retailer === "monoprix"),
    [products]
  );

  // Open creator automatically if user clicked "Comparer en duel" from Catalog
  useEffect(() => {
    if (!preselectedProduct) return;
    setEditingId(null);
    setDuelName(preselectedProduct.customName ?? preselectedProduct.rawLabel);
    setDuelMode(
      preselectedProduct.lastPricePerKgOrL !== null ? "per_kg_or_l" : "unit"
    );
    if (preselectedProduct.retailer === "carrefour") {
      setSelectedCarrefour([preselectedProduct.rawLabel]);
      setSelectedMonoprix([]);
      setCarrefourSearch("");
      setMonoprixSearch(
        preselectedProduct.rawLabel.split(" ").slice(0, 2).join(" ")
      );
    } else {
      setSelectedMonoprix([preselectedProduct.rawLabel]);
      setSelectedCarrefour([]);
      setMonoprixSearch("");
      setCarrefourSearch(
        preselectedProduct.rawLabel.split(" ").slice(0, 2).join(" ")
      );
    }
    setModalOpen(true);
    onClearPreselected?.();
  }, [preselectedProduct, onClearPreselected]);

  function openNewDuelModal() {
    setEditingId(null);
    setDuelName("");
    setDuelMode("unit");
    setSelectedCarrefour([]);
    setSelectedMonoprix([]);
    setCarrefourSearch("");
    setMonoprixSearch("");
    setModalOpen(true);
  }

  function openEditDuelModal(comp: ProductComparisonView) {
    setEditingId(comp.id);
    setDuelName(comp.name);
    setDuelMode(comp.compareMode);
    setSelectedCarrefour(comp.carrefourLabels);
    setSelectedMonoprix(comp.monoprixLabels);
    setCarrefourSearch("");
    setMonoprixSearch("");
    setModalOpen(true);
  }

  async function handleSaveDuel() {
    if (
      !duelName.trim() ||
      (selectedCarrefour.length === 0 && selectedMonoprix.length === 0)
    ) {
      return;
    }
    setSaving(true);
    try {
      const url =
        editingId !== null
          ? `/api/comparisons/${editingId}`
          : "/api/comparisons";
      const method = editingId !== null ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: duelName.trim(),
          compareMode: duelMode,
          carrefourLabels: selectedCarrefour,
          monoprixLabels: selectedMonoprix,
        }),
      });
      if (res.ok) {
        setModalOpen(false);
        onComparisonsChanged();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAcceptSuggestion(s: SuggestedComparisonMatch) {
    const key = `${s.carrefourProduct.rawLabel}::${s.monoprixProduct.rawLabel}`;
    setBusyKey(key);
    try {
      const res = await fetch("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: s.suggestedName,
          compareMode: s.recommendedMode,
          carrefourLabels: [s.carrefourProduct.rawLabel],
          monoprixLabels: [s.monoprixProduct.rawLabel],
        }),
      });
      if (res.ok) {
        onComparisonsChanged();
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDismissSuggestion(s: SuggestedComparisonMatch) {
    const key = `${s.carrefourProduct.rawLabel}::${s.monoprixProduct.rawLabel}`;
    setBusyKey(key);
    try {
      const res = await fetch("/api/comparisons/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrefourLabel: s.carrefourProduct.rawLabel,
          monoprixLabel: s.monoprixProduct.rawLabel,
        }),
      });
      if (res.ok) {
        onComparisonsChanged();
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function handleToggleMode(comp: ProductComparisonView) {
    const nextMode: CompareMode =
      comp.compareMode === "unit" ? "per_kg_or_l" : "unit";
    setBusyKey(`mode-${comp.id}`);
    try {
      const res = await fetch(`/api/comparisons/${comp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compareMode: nextMode }),
      });
      if (res.ok) {
        onComparisonsChanged();
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeleteDuel(id: number) {
    setBusyKey(`del-${id}`);
    try {
      const res = await fetch(`/api/comparisons/${id}`, { method: "DELETE" });
      if (res.ok) {
        onComparisonsChanged();
      }
    } finally {
      setBusyKey(null);
    }
  }

  const summary = useMemo(() => {
    let carrefourWins = 0;
    let monoprixWins = 0;
    let ties = 0;
    let totalCarrefourBasket = 0;
    let totalMonoprixBasket = 0;
    let totalBestBasket = 0;

    for (const c of comparisons) {
      const res = compareBasis === "net" ? c.net : c.shelf;
      if (res.winner === "carrefour") carrefourWins++;
      else if (res.winner === "monoprix") monoprixWins++;
      else if (res.winner === "tie") ties++;

      if (res.carrefourPrice !== null && res.monoprixPrice !== null) {
        totalCarrefourBasket += res.carrefourPrice;
        totalMonoprixBasket += res.monoprixPrice;
        totalBestBasket += Math.min(res.carrefourPrice, res.monoprixPrice);
      }
    }

    const totalPotentialSavedVsWorst =
      Math.max(totalCarrefourBasket, totalMonoprixBasket) - totalBestBasket;

    return {
      carrefourWins,
      monoprixWins,
      ties,
      totalCarrefourBasket: Math.round(totalCarrefourBasket * 100) / 100,
      totalMonoprixBasket: Math.round(totalMonoprixBasket * 100) / 100,
      totalBestBasket: Math.round(totalBestBasket * 100) / 100,
      totalPotentialSavedVsWorst:
        Math.round(totalPotentialSavedVsWorst * 100) / 100,
    };
  }, [comparisons, compareBasis]);

  const filteredComparisons = useMemo(() => {
    const tokens = stripAccents(searchQuery)
      .split(" ")
      .filter((t) => t.length > 0);

    const list = comparisons.filter((c) => {
      if (tokens.length > 0) {
        const hay = stripAccents(
          `${c.name} ${c.carrefourLabels.join(" ")} ${c.monoprixLabels.join(" ")}`
        );
        if (!tokens.every((t) => hay.includes(t))) return false;
      }

      const res = compareBasis === "net" ? c.net : c.shelf;
      if (winnerFilter !== "all" && res.winner !== winnerFilter) return false;
      return true;
    });

    list.sort((a, b) => {
      const ra = compareBasis === "net" ? a.net : a.shelf;
      const rb = compareBasis === "net" ? b.net : b.shelf;
      if (duelSort === "savings_pct") {
        return (rb.savingsPct ?? -1) - (ra.savingsPct ?? -1);
      }
      if (duelSort === "savings_abs") {
        return (rb.savingsAmount ?? -1) - (ra.savingsAmount ?? -1);
      }
      return a.name.localeCompare(b.name, "fr");
    });

    return list;
  }, [comparisons, searchQuery, winnerFilter, duelSort, compareBasis]);

  const filteredCarrefourPicker = useMemo(() => {
    const tokens = stripAccents(carrefourSearch)
      .split(" ")
      .filter(Boolean);
    return carrefourProducts.filter((p) => {
      if (tokens.length === 0) return true;
      const hay = stripAccents(`${p.rawLabel} ${p.normalizedLabel}`);
      return tokens.every((t) => hay.includes(t));
    });
  }, [carrefourProducts, carrefourSearch]);

  const filteredMonoprixPicker = useMemo(() => {
    const tokens = stripAccents(monoprixSearch)
      .split(" ")
      .filter(Boolean);
    return monoprixProducts.filter((p) => {
      if (tokens.length === 0) return true;
      const hay = stripAccents(`${p.rawLabel} ${p.normalizedLabel}`);
      return tokens.every((t) => hay.includes(t));
    });
  }, [monoprixProducts, monoprixSearch]);

  return (
    <div className="space-y-5">
      {/* Scoreboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-blue-200 p-4 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-blue-700 uppercase">
              Moins cher chez Carrefour
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {summary.carrefourWins} produit(s)
            </div>
            <div className="text-xs text-slate-500">
              Panier duels 100% Carrefour :{" "}
              <strong>{summary.totalCarrefourBasket.toFixed(2)} €</strong>
            </div>
          </div>
          <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Trophy className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-rose-200 p-4 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-rose-700 uppercase">
              Moins cher chez Monoprix
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {summary.monoprixWins} produit(s)
            </div>
            <div className="text-xs text-slate-500">
              Panier duels 100% Monoprix :{" "}
              <strong>{summary.totalMonoprixBasket.toFixed(2)} €</strong>
            </div>
          </div>
          <div className="h-11 w-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <Trophy className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-white rounded-2xl border border-emerald-200 p-4 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-emerald-800 uppercase">
              Panier optimal (mixte)
            </div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">
              {summary.totalBestBasket.toFixed(2)} €
            </div>
            <div className="text-xs text-emerald-700">
              {summary.totalPotentialSavedVsWorst > 0
                ? `-${summary.totalPotentialSavedVsWorst.toFixed(2)} € vs l'enseigne la plus chère`
                : "Créez des duels pour calculer vos gains"}
            </div>
          </div>
          <div className="h-11 w-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <ArrowRightLeft className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrer vos duels (ex: sucrine, pain au lait, saumon...)"
              className="w-full pl-10 pr-8 py-2 rounded-xl border border-slate-300 text-sm focus:border-blue-500 outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={duelSort}
              onChange={(e) => setDuelSort(e.target.value as DuelSort)}
              className="px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white text-slate-700 outline-none"
            >
              <option value="savings_pct">Tri : Plus gros écart %</option>
              <option value="savings_abs">Tri : Plus grosse économie €</option>
              <option value="name">Tri : Nom A-Z</option>
            </select>

            <div className="inline-flex rounded-xl border border-slate-300 p-0.5 bg-slate-50 text-xs font-medium">
              <button
                type="button"
                onClick={() => onChangeCompareBasis("net")}
                className={`px-2.5 py-1.5 rounded-lg cursor-pointer transition ${
                  compareBasis === "net"
                    ? "bg-emerald-600 text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Prix net (-10% Club / M+)
              </button>
              <button
                type="button"
                onClick={() => onChangeCompareBasis("shelf")}
                className={`px-2.5 py-1.5 rounded-lg cursor-pointer transition ${
                  compareBasis === "shelf"
                    ? "bg-slate-800 text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Prix affiché
              </button>
            </div>

            <button
              type="button"
              onClick={openNewDuelModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Créer un duel</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              ["all", `Tous (${comparisons.length})`],
              ["carrefour", `Avantage Carrefour (${summary.carrefourWins})`],
              ["monoprix", `Avantage Monoprix (${summary.monoprixWins})`],
              ["incomplete", "À compléter"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setWinnerFilter(key)}
              className={`px-3 py-1.5 rounded-full font-medium cursor-pointer transition ${
                winnerFilter === key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Automatic suggestions */}
      {suggestions.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-950">
              <Sparkles className="h-4 w-4 text-amber-600" />
              <span>
                Associations automatiques détectées ({suggestions.length})
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-amber-800">
                Validez ou ignorez en 1 clic
              </span>
              {suggestions.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllSuggestions((v) => !v)}
                  className="text-xs font-semibold text-amber-900 underline hover:text-amber-700 cursor-pointer"
                >
                  {showAllSuggestions
                    ? "Afficher moins"
                    : `Tout voir (${suggestions.length})`}
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {(showAllSuggestions ? suggestions : suggestions.slice(0, 6)).map(
              (s) => {
                const pairKey = `${s.carrefourProduct.rawLabel}::${s.monoprixProduct.rawLabel}`;
                const isBusy = busyKey === pairKey;
                const cPrice =
                  s.recommendedMode === "per_kg_or_l" &&
                  s.carrefourProduct.lastNetPricePerKgOrL !== null
                    ? `${s.carrefourProduct.lastNetPricePerKgOrL.toFixed(2)} €/${
                        s.carrefourProduct.unitType === "L" ? "L" : "kg"
                      }`
                    : `${s.carrefourProduct.lastNetUnitPrice.toFixed(2)} €`;
                const mPrice =
                  s.recommendedMode === "per_kg_or_l" &&
                  s.monoprixProduct.lastNetPricePerKgOrL !== null
                    ? `${s.monoprixProduct.lastNetPricePerKgOrL.toFixed(2)} €/${
                        s.monoprixProduct.unitType === "L" ? "L" : "kg"
                      }`
                    : `${s.monoprixProduct.lastNetUnitPrice.toFixed(2)} €`;

                return (
                  <div
                    key={pairKey}
                    className="bg-white rounded-xl border border-amber-200/80 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-1 text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold">
                          Carrefour : {cPrice}
                        </span>
                        <span className="truncate font-medium text-slate-800">
                          {s.carrefourProduct.rawLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold">
                          Monoprix : {mPrice}
                        </span>
                        <span className="truncate font-medium text-slate-800">
                          {s.monoprixProduct.rawLabel}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleAcceptSuggestion(s)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Valider</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDismissSuggestion(s)}
                        title="Ne pas associer ces deux produits"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium cursor-pointer disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>Ignorer</span>
                      </button>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>
      )}

      {/* Duels list */}
      {filteredComparisons.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
          <p className="text-sm text-slate-600">
            {monoprixProducts.length === 0
              ? "Importez d'abord une facture PDF Monoprix via « Importer des PDF » pour comparer vos produits côte à côte."
              : "Aucun duel ne correspond à vos filtres. Validez une suggestion ci-dessus ou cliquez sur « Créer un duel »."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredComparisons.map((c) => {
            const res = compareBasis === "net" ? c.net : c.shelf;
            return (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900">
                      {c.name}
                    </h3>
                    <button
                      type="button"
                      disabled={busyKey === `mode-${c.id}`}
                      onClick={() => handleToggleMode(c)}
                      title="Basculer entre comparaison à l'unité et au kg / litre"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                    >
                      <Scale className="h-3 w-3" />
                      {c.compareMode === "per_kg_or_l"
                        ? "Comparé au kg / L"
                        : "Comparé à l'unité"}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {res.winner === "carrefour" && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-600 text-white">
                        Acheter Carrefour (-{res.savingsAmount?.toFixed(2)}{" "}
                        {res.unitLabel} / -{res.savingsPct}%)
                      </span>
                    )}
                    {res.winner === "monoprix" && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-rose-600 text-white">
                        Acheter Monoprix (-{res.savingsAmount?.toFixed(2)}{" "}
                        {res.unitLabel} / -{res.savingsPct}%)
                      </span>
                    )}
                    {res.winner === "tie" && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-200 text-slate-800">
                        Prix identique
                      </span>
                    )}
                    {res.winner === "incomplete" && (
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        Donnée manquante d&apos;un côté
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => openEditDuelModal(c)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer"
                      title="Modifier le duel"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === `del-${c.id}`}
                      onClick={() => handleDeleteDuel(c.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                      title="Supprimer le duel"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Side by side cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Carrefour side */}
                  <div
                    className={`rounded-xl p-3 border ${
                      res.winner === "carrefour"
                        ? "bg-blue-50/80 border-blue-300"
                        : "bg-slate-50/70 border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-bold uppercase text-blue-800">
                        Carrefour
                      </span>
                      {c.carrefourProduct && (
                        <span className="text-[11px] text-slate-500">
                          {new Date(
                            c.carrefourProduct.lastPurchaseDate
                          ).toLocaleDateString("fr-FR")}{" "}
                          ·{" "}
                          {c.carrefourProduct.lastStoreName.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    {c.carrefourProduct ? (
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-xs font-medium text-slate-700 truncate">
                          {c.carrefourProduct.rawLabel}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-lg font-bold text-slate-900">
                            {res.carrefourPrice?.toFixed(2)} {res.unitLabel}
                          </span>
                          {c.compareMode === "unit" &&
                            c.carrefourProduct.lastNetPricePerKgOrL !== null && (
                              <div className="text-[11px] text-blue-700">
                                {(compareBasis === "net"
                                  ? c.carrefourProduct.lastNetPricePerKgOrL
                                  : c.carrefourProduct.lastPricePerKgOrL
                                )?.toFixed(2)}{" "}
                                €/
                                {c.carrefourProduct.unitType === "L"
                                  ? "L"
                                  : "kg"}
                              </div>
                            )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic">
                        Aucun produit Carrefour associé
                      </div>
                    )}
                  </div>

                  {/* Monoprix side */}
                  <div
                    className={`rounded-xl p-3 border ${
                      res.winner === "monoprix"
                        ? "bg-rose-50/80 border-rose-300"
                        : "bg-slate-50/70 border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-bold uppercase text-rose-800">
                        Monoprix (incl. -10% M+)
                      </span>
                      {c.monoprixProduct && (
                        <span className="text-[11px] text-slate-500">
                          {new Date(
                            c.monoprixProduct.lastPurchaseDate
                          ).toLocaleDateString("fr-FR")}
                        </span>
                      )}
                    </div>
                    {c.monoprixProduct ? (
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-xs font-medium text-slate-700 truncate">
                          {c.monoprixProduct.rawLabel}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-lg font-bold text-slate-900">
                            {res.monoprixPrice?.toFixed(2)} {res.unitLabel}
                          </span>
                          {c.compareMode === "unit" &&
                            c.monoprixProduct.lastNetPricePerKgOrL !== null && (
                              <div className="text-[11px] text-rose-700">
                                {(compareBasis === "net"
                                  ? c.monoprixProduct.lastNetPricePerKgOrL
                                  : c.monoprixProduct.lastPricePerKgOrL
                                )?.toFixed(2)}{" "}
                                €/
                                {c.monoprixProduct.unitType === "L"
                                  ? "L"
                                  : "kg"}
                              </div>
                            )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic">
                        Aucun produit Monoprix associé
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Duel Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-base font-bold text-slate-900">
                {editingId !== null
                  ? "Modifier le duel Carrefour vs Monoprix"
                  : "Créer un duel Carrefour vs Monoprix"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nom du produit comparé
                  </label>
                  <input
                    type="text"
                    value={duelName}
                    onChange={(e) => setDuelName(e.target.value)}
                    placeholder="Ex: Sucrine, Pains au lait Bio, Lait sans lactose..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Base de comparaison
                  </label>
                  <select
                    value={duelMode}
                    onChange={(e) =>
                      setDuelMode(e.target.value as CompareMode)
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white outline-none focus:border-blue-500"
                  >
                    <option value="unit">À l&apos;unité / paquet</option>
                    <option value="per_kg_or_l">Au kilo / au litre</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Carrefour Picker */}
                <div className="border border-blue-200 rounded-xl p-3 bg-blue-50/30 space-y-2">
                  <div className="text-xs font-bold text-blue-900 uppercase">
                    Produit(s) Carrefour ({selectedCarrefour.length})
                  </div>
                  <input
                    type="text"
                    value={carrefourSearch}
                    onChange={(e) => setCarrefourSearch(e.target.value)}
                    placeholder="Rechercher chez Carrefour..."
                    className="w-full px-2.5 py-1.5 rounded-lg border border-blue-200 bg-white text-xs outline-none"
                  />
                  <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                    {filteredCarrefourPicker.map((p) => {
                      const checked = selectedCarrefour.includes(p.rawLabel);
                      return (
                        <label
                          key={p.key}
                          className={`flex items-center justify-between gap-2 p-2 rounded-lg text-xs cursor-pointer border ${
                            checked
                              ? "bg-blue-100 border-blue-300 text-blue-950"
                              : "bg-white border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedCarrefour((prev) =>
                                  checked
                                    ? prev.filter((x) => x !== p.rawLabel)
                                    : [...prev, p.rawLabel]
                                );
                                if (!duelName.trim()) setDuelName(p.rawLabel);
                              }}
                            />
                            <span className="truncate font-medium">
                              {p.rawLabel}
                            </span>
                          </div>
                          <span className="font-bold shrink-0">
                            {p.lastNetUnitPrice.toFixed(2)} €
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Monoprix Picker */}
                <div className="border border-rose-200 rounded-xl p-3 bg-rose-50/30 space-y-2">
                  <div className="text-xs font-bold text-rose-900 uppercase">
                    Produit(s) Monoprix ({selectedMonoprix.length})
                  </div>
                  <input
                    type="text"
                    value={monoprixSearch}
                    onChange={(e) => setMonoprixSearch(e.target.value)}
                    placeholder="Rechercher chez Monoprix..."
                    className="w-full px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-xs outline-none"
                  />
                  <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                    {filteredMonoprixPicker.map((p) => {
                      const checked = selectedMonoprix.includes(p.rawLabel);
                      return (
                        <label
                          key={p.key}
                          className={`flex items-center justify-between gap-2 p-2 rounded-lg text-xs cursor-pointer border ${
                            checked
                              ? "bg-rose-100 border-rose-300 text-rose-950"
                              : "bg-white border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedMonoprix((prev) =>
                                  checked
                                    ? prev.filter((x) => x !== p.rawLabel)
                                    : [...prev, p.rawLabel]
                                );
                                if (!duelName.trim()) setDuelName(p.rawLabel);
                              }}
                            />
                            <span className="truncate font-medium">
                              {p.rawLabel}
                            </span>
                          </div>
                          <span className="font-bold shrink-0">
                            {p.lastNetUnitPrice.toFixed(2)} €
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={
                  saving ||
                  !duelName.trim() ||
                  (selectedCarrefour.length === 0 &&
                    selectedMonoprix.length === 0)
                }
                onClick={handleSaveDuel}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
              >
                {saving ? "Enregistrement..." : "Enregistrer ce duel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
