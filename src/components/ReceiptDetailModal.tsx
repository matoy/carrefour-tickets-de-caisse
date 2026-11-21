"use client";

import { useState } from "react";
import {
  X,
  Receipt as ReceiptIcon,
  Calendar,
  MapPin,
  CreditCard,
  Award,
  Trash2,
  Tag,
  Percent,
  Package,
} from "lucide-react";
import type { ReceiptListItem } from "@/lib/db/receipt-service";

interface ReceiptDetailModalProps {
  receipt: ReceiptListItem | null;
  onClose: () => void;
  onDeleted: (id: number) => void;
}

export function ReceiptDetailModal({
  receipt,
  onClose,
  onDeleted,
}: ReceiptDetailModalProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!receipt) return null;

  const items = receipt.items ?? [];
  const isMonoprix = receipt.retailer === "monoprix";

  async function handleDelete() {
    if (!receipt) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onDeleted(receipt.id);
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-start justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-slate-50">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <ReceiptIcon
                className={`h-5 w-5 ${
                  isMonoprix ? "text-rose-600" : "text-blue-600"
                }`}
              />
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                  isMonoprix
                    ? "bg-rose-100 text-rose-800"
                    : "bg-blue-100 text-blue-800"
                }`}
              >
                {isMonoprix ? "Monoprix" : "Carrefour"}
              </span>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                {receipt.storeName}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {new Date(receipt.purchaseDate).toLocaleString("fr-FR", {
                  dateStyle: "long",
                  timeStyle: "short",
                })}
              </span>
              {receipt.storeCode && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  Magasin #{receipt.storeCode}
                </span>
              )}
              <span className="font-mono bg-slate-200/70 px-1.5 py-0.5 rounded text-slate-700">
                {isMonoprix ? "Facture" : "Ticket"} {receipt.ticketKey}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-200/70 transition cursor-pointer shrink-0"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Receipt body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-5">
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-slate-50 text-[11px] sm:text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 px-2.5 sm:py-2.5 sm:px-3">
                    Article
                  </th>
                  <th className="text-right py-2 px-2 sm:py-2.5 sm:px-3">
                    Qté × P.U.
                  </th>
                  <th className="hidden sm:table-cell text-right py-2.5 px-3">
                    Brut
                  </th>
                  <th className="text-right py-2 px-2.5 sm:py-2.5 sm:px-3">
                    Net réel
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const hasDiscount =
                    item.immediateDiscount > 0 || item.loyaltyDiscount > 0;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="py-2 px-2.5 sm:py-2.5 sm:px-3">
                        <div className="font-medium text-slate-900">
                          {item.rawLabel}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-0.5 text-[11px] sm:text-xs text-slate-500">
                          {item.vatRate !== null && (
                            <span>TVA {item.vatRate.toFixed(1)}%</span>
                          )}
                          {item.weightKg !== null && (
                            <span className="text-blue-700 font-medium">
                              {item.weightKg} kg
                              {item.pricePerKgOrL !== null
                                ? ` · ${item.pricePerKgOrL.toFixed(2)} €/kg`
                                : ""}
                            </span>
                          )}
                          {item.volumeL !== null && (
                            <span className="text-blue-700 font-medium">
                              {item.volumeL} L
                              {item.pricePerKgOrL !== null
                                ? ` · ${item.pricePerKgOrL.toFixed(2)} €/L`
                                : ""}
                            </span>
                          )}
                          {item.immediateDiscount > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded font-medium">
                              <Tag className="h-3 w-3" />-
                              {item.immediateDiscount.toFixed(2)} € promo
                            </span>
                          )}
                          {item.loyaltyDiscount > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">
                              {isMonoprix ? (
                                <Percent className="h-3 w-3" />
                              ) : (
                                <Award className="h-3 w-3" />
                              )}
                              -{item.loyaltyDiscount.toFixed(2)} €{" "}
                              {isMonoprix ? "M+" : "Club"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 sm:py-2.5 sm:px-3 text-right text-slate-600 whitespace-nowrap font-mono text-[11px] sm:text-xs">
                        {item.quantity} × {item.unitPrice.toFixed(2)} €
                      </td>
                      <td className="hidden sm:table-cell py-2.5 px-3 text-right font-medium text-slate-800 whitespace-nowrap">
                        {item.totalPrice.toFixed(2)} €
                      </td>
                      <td
                        className={`py-2 px-2.5 sm:py-2.5 sm:px-3 text-right font-semibold whitespace-nowrap ${
                          hasDiscount ? "text-emerald-700" : "text-slate-900"
                        }`}
                      >
                        <div>{item.netTotalPrice.toFixed(2)} €</div>
                        {hasDiscount && (
                          <div className="sm:hidden text-[10px] font-normal text-slate-400 line-through">
                            {item.totalPrice.toFixed(2)} €
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals summary */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Total brut articles ({items.length} lignes)</span>
              <span>{receipt.totalBeforeDiscount.toFixed(2)} €</span>
            </div>
            {receipt.totalImmediateDiscount > 0 && (
              <div className="flex justify-between text-rose-700 font-medium">
                <span>
                  {isMonoprix
                    ? "Total remises marchandises"
                    : "Total remises immédiates"}
                </span>
                <span>-{receipt.totalImmediateDiscount.toFixed(2)} €</span>
              </div>
            )}
            {receipt.globalDiscount > 0 && (
              <div className="flex justify-between text-emerald-700 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Percent className="h-4 w-4" />
                  Remise abonnement M+ (-10%)
                </span>
                <span>-{receipt.globalDiscount.toFixed(2)} €</span>
              </div>
            )}
            {receipt.extraFees !== 0 && (
              <div className="flex justify-between text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <Package className="h-4 w-4" />
                  Frais préparation / livraison / consignes sacs (net)
                </span>
                <span>
                  {receipt.extraFees > 0 ? "+" : ""}
                  {receipt.extraFees.toFixed(2)} €
                </span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-200">
              <span>
                {isMonoprix ? "Total de la commande" : "Total payé en caisse"}
              </span>
              <span>{receipt.totalPaid.toFixed(2)} €</span>
            </div>
            {receipt.loyaltyCredited > 0 && (
              <div className="flex justify-between text-emerald-700 font-semibold pt-1">
                <span className="inline-flex items-center gap-1.5">
                  <Award className="h-4 w-4" />
                  {isMonoprix
                    ? "Cagnotté Monoprix"
                    : "Cagnotté sur Carte Club Carrefour"}
                </span>
                <span>+{receipt.loyaltyCredited.toFixed(2)} €</span>
              </div>
            )}
            {receipt.paymentMethod && (
              <div className="flex justify-between text-xs text-slate-500 pt-2 border-t border-slate-200">
                <span className="inline-flex items-center gap-1">
                  <CreditCard className="h-3.5 w-3.5" />
                  Paiement / Canal
                </span>
                <span>{receipt.paymentMethod}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3 border-t border-slate-200 bg-slate-50">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
              <span>Supprimer ce document</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-rose-700 font-medium">
                Confirmer la suppression ?
              </span>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
              >
                {deleting ? "Suppression..." : "Oui, supprimer"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-slate-600 cursor-pointer"
              >
                Annuler
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
