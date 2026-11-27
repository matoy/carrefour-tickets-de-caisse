"use client";

import { useState, type DragEvent } from "react";
import {
  X,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileText,
  FolderSync,
} from "lucide-react";
import type { UpsertResult } from "@/lib/db/receipt-service";

interface SyncModalProps {
  open: boolean;
  onClose: () => void;
  onSyncSuccess: () => void;
  lastSyncAt: string | null;
}

export function SyncModal({
  open,
  onClose,
  onSyncSuccess,
  lastSyncAt,
}: SyncModalProps) {
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error";
    title: string;
    results?: UpsertResult[];
    errors?: string[];
  } | null>(null);

  if (!open) return null;

  async function uploadPdfFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    if (files.length === 0) {
      setFeedback({
        type: "error",
        title: "Veuillez sélectionner au moins un fichier .pdf",
      });
      return;
    }

    setLoading(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }

      const res = await fetch("/api/receipts/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        insertedCount?: number;
        skippedCount?: number;
        results?: UpsertResult[];
        errors?: string[];
        error?: string;
      };

      if (!res.ok) {
        setFeedback({
          type: "error",
          title: data.error ?? "Erreur lors de l'import PDF",
          errors: data.errors,
        });
        return;
      }

      const inserted = data.insertedCount ?? 0;
      const skipped = data.skippedCount ?? 0;
      setFeedback({
        type: inserted > 0 ? "success" : "warning",
        title: `${inserted} nouveau(x) ticket(s) / facture(s) inséré(s), ${skipped} déjà présent(s) ignoré(s).`,
        results: data.results,
        errors: data.errors,
      });
      if (inserted > 0) {
        onSyncSuccess();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        title: "Échec de l'envoi des fichiers PDF",
        errors: [err instanceof Error ? err.message : String(err)],
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncLocalFolder() {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/receipts/sync-local", { method: "POST" });
      const data = (await res.json()) as {
        foundFiles?: string[];
        insertedCount?: number;
        skippedCount?: number;
        results?: UpsertResult[];
        errors?: string[];
      };

      const found = data.foundFiles?.length ?? 0;
      const inserted = data.insertedCount ?? 0;
      const skipped = data.skippedCount ?? 0;

      setFeedback({
        type: inserted > 0 ? "success" : "warning",
        title:
          found === 0
            ? "Aucun fichier PDF trouvé dans le dossier du serveur."
            : `${found} PDF scanné(s) : ${inserted} nouveau(x) inséré(s), ${skipped} déjà en base.`,
        results: data.results,
        errors: data.errors,
      });
      if (inserted > 0) {
        onSyncSuccess();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        title: "Erreur lors du scan local",
        errors: [err instanceof Error ? err.message : String(err)],
      });
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      void uploadPdfFiles(e.dataTransfer.files);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600 shrink-0" />
              <span>Importer des PDF</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Détection automatique Carrefour & Monoprix (remise M+ 10%).
              {lastSyncAt
                ? ` Dernier import : ${new Date(lastSyncAt).toLocaleDateString("fr-FR")}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-200/70 transition cursor-pointer"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 text-xs">
                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3">
                  <div className="font-bold text-blue-900">
                    Carrefour (Magasin)
                  </div>
                  <p className="text-blue-800 mt-0.5">
                    Tickets <code>*_ticket.pdf</code> : prix affiché, remises
                    immédiates, cagnotte -10% Club et poids vrac.
                  </p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3">
                  <div className="font-bold text-rose-900">
                    Monoprix.fr (Courses)
                  </div>
                  <p className="text-rose-800 mt-0.5">
                    Factures PDF Monoprix : promos articles,{" "}
                    <strong>10% remise M+</strong> répartie sur chaque article
                    et frais séparés.
                  </p>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-5 sm:p-8 text-center transition ${
                  dragActive
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-300 hover:border-slate-400 bg-slate-50/50"
                }`}
              >
                <Upload className="h-7 w-7 sm:h-8 sm:w-8 text-blue-600 mx-auto mb-2.5 sm:mb-3" />
                <p className="text-sm font-semibold text-slate-800">
                  Sélectionnez ou déposez vos tickets et factures (.pdf)
                </p>
                <p className="text-xs text-slate-500 mt-1 mb-4">
                  Vous pouvez importer plusieurs PDF des deux enseignes à la
                  fois. Les doublons sont ignorés.
                </p>
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>
                    {loading ? "Import en cours..." : "Choisir des fichiers PDF"}
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    disabled={loading}
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        void uploadPdfFiles(e.target.files);
                      }
                    }}
                  />
                </label>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">
                    Synchroniser les PDF du dossier serveur
                  </p>
                  <p>
                    Scanne les fichiers <code>*.pdf</code> placés à la racine du
                    projet local.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSyncLocalFolder}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <FolderSync className="h-4 w-4 text-blue-600" />
                  <span>Scanner</span>
                </button>
              </div>

              {/* PDF Feedback banner */}
              {feedback && (
                <div
                  className={`rounded-xl p-4 border text-sm space-y-2 ${
                    feedback.type === "success"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                      : feedback.type === "warning"
                      ? "bg-amber-50 border-amber-200 text-amber-900"
                      : "bg-red-50 border-red-200 text-red-900"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {feedback.type === "success" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-2 flex-1">
                      <p className="font-semibold">{feedback.title}</p>

                      {feedback.results && feedback.results.length > 0 && (
                        <ul className="space-y-1 text-xs">
                          {feedback.results.map((r) => (
                            <li
                              key={r.externalId}
                              className="flex flex-wrap items-center justify-between gap-2 bg-white/70 rounded-lg px-2.5 py-1.5"
                            >
                              <span className="font-medium">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase mr-1.5 ${
                                    r.retailer === "monoprix"
                                      ? "bg-rose-100 text-rose-800"
                                      : "bg-blue-100 text-blue-800"
                                  }`}
                                >
                                  {r.retailer}
                                </span>
                                {r.storeName} (#{r.ticketKey}) · {r.itemCount}{" "}
                                art.
                              </span>
                              <span className="font-semibold">
                                {r.totalPaid.toFixed(2)} € ·{" "}
                                {r.inserted ? (
                                  <span className="text-emerald-700">
                                    Ajouté
                                  </span>
                                ) : (
                                  <span className="text-slate-500">
                                    Déjà en base
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {feedback.errors && feedback.errors.length > 0 && (
                        <ul className="list-disc list-inside text-xs space-y-0.5 text-rose-800">
                          {feedback.errors.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}
        </div>
      </div>
    </div>
  );
}
