"use client";

import { useState, type DragEvent } from "react";
import {
  X,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileText,
  FolderSync,
  Database,
  Download,
  ArchiveRestore,
} from "lucide-react";
import type { UpsertResult } from "@/lib/db/receipt-service";
import type {
  BackupImportMode,
  BackupImportReport,
  BackupPreviewSummary,
} from "@/lib/db/backup-service";

interface SyncModalProps {
  open: boolean;
  onClose: () => void;
  onSyncSuccess: () => void;
  lastSyncAt: string | null;
}

type ModalTab = "pdf" | "backup";

function formatBytesKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  return `${(bytes / 1024).toFixed(1)} Ko`;
}

export function SyncModal({
  open,
  onClose,
  onSyncSuccess,
  lastSyncAt,
}: SyncModalProps) {
  const [modalTab, setModalTab] = useState<ModalTab>("pdf");
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error";
    title: string;
    results?: UpsertResult[];
    errors?: string[];
  } | null>(null);

  // Backup state
  const [exporting, setExporting] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPreview, setBackupPreview] =
    useState<BackupPreviewSummary | null>(null);
  const [backupMode, setBackupMode] = useState<BackupImportMode>("merge");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [backupReport, setBackupReport] = useState<BackupImportReport | null>(
    null
  );
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupDragActive, setBackupDragActive] = useState(false);

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

  async function handleExportBackup() {
    setExporting(true);
    setBackupError(null);
    try {
      const res = await fetch("/api/backup/export");
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setBackupError(
          errJson.error ?? "Impossible de télécharger la sauvegarde."
        );
        return;
      }

      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const fileName = match?.[1] ?? "courses-backup.json.gz";

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : "Erreur réseau lors de l'export."
      );
    } finally {
      setExporting(false);
    }
  }

  async function analyzeBackupFile(file: File) {
    setBackupFile(file);
    setBackupPreview(null);
    setBackupReport(null);
    setBackupError(null);
    setConfirmReplace(false);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dryRun", "true");
      formData.append("mode", backupMode);

      const res = await fetch("/api/backup/import", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        preview?: BackupPreviewSummary;
        error?: string;
      };

      if (!res.ok || !data.preview) {
        setBackupFile(null);
        setBackupError(
          data.error ?? "Impossible de lire ce fichier de sauvegarde."
        );
        return;
      }

      setBackupPreview(data.preview);
    } catch (err) {
      setBackupFile(null);
      setBackupError(
        err instanceof Error ? err.message : "Erreur lors de l'analyse."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmBackupImport() {
    if (!backupFile || !backupPreview) return;
    if (backupMode === "replace" && !confirmReplace) return;

    setLoading(true);
    setBackupError(null);
    setBackupReport(null);

    try {
      const formData = new FormData();
      formData.append("file", backupFile);
      formData.append("dryRun", "false");
      formData.append("mode", backupMode);

      const res = await fetch("/api/backup/import", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        report?: BackupImportReport;
        error?: string;
      };

      if (!res.ok || !data.report) {
        setBackupError(
          data.error ?? "Erreur lors de la restauration de la sauvegarde."
        );
        return;
      }

      setBackupReport(data.report);
      setBackupPreview(null);
      setBackupFile(null);
      setConfirmReplace(false);
      onSyncSuccess();
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : "Erreur réseau lors de l'import."
      );
    } finally {
      setLoading(false);
    }
  }

  function resetBackupSelection() {
    setBackupFile(null);
    setBackupPreview(null);
    setConfirmReplace(false);
    setBackupError(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              {modalTab === "pdf" ? (
                <FileText className="h-5 w-5 text-blue-600 shrink-0" />
              ) : (
                <Database className="h-5 w-5 text-indigo-600 shrink-0" />
              )}
              <span>
                {modalTab === "pdf"
                  ? "Importer des PDF"
                  : "Sauvegarde BDD (.json.gz)"}
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {modalTab === "pdf"
                ? `Détection automatique Carrefour & Monoprix (remise M+ 10%).${
                    lastSyncAt
                      ? ` Dernier import : ${new Date(lastSyncAt).toLocaleDateString("fr-FR")}`
                      : ""
                  }`
                : "Export complet compressé et restauration avec aperçu préalable."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-200/70 transition cursor-pointer"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50/70 text-xs sm:text-sm font-semibold">
          <button
            type="button"
            onClick={() => setModalTab("pdf")}
            className={`py-2.5 px-3 flex items-center justify-center gap-1.5 border-b-2 transition cursor-pointer ${
              modalTab === "pdf"
                ? "border-blue-600 text-blue-700 bg-white"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>PDF (Carrefour / Monoprix)</span>
          </button>
          <button
            type="button"
            onClick={() => setModalTab("backup")}
            className={`py-2.5 px-3 flex items-center justify-center gap-1.5 border-b-2 transition cursor-pointer ${
              modalTab === "backup"
                ? "border-indigo-600 text-indigo-700 bg-white"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Database className="h-4 w-4" />
            <span>Sauvegarde BDD (.json.gz)</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-6 overflow-y-auto space-y-4">
          {modalTab === "pdf" ? (
            <>
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
            </>
          ) : (
            /* TAB 2: Backup Export / Import (.json.gz) */
            <div className="space-y-4">
              {/* Export block */}
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-indigo-950">
                      1. Exporter toute la base (.json.gz)
                    </h3>
                    <p className="text-xs text-indigo-900/80">
                      Inclut tickets, articles, notes/renommages, duels,
                      suggestions ignorées et texte brut masqué, compressés en
                      Gzip.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={handleExportBackup}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold shadow-2xs cursor-pointer shrink-0"
                  >
                    <Download className="h-4 w-4" />
                    <span>
                      {exporting
                        ? "Compression..."
                        : "Télécharger (.json.gz)"}
                    </span>
                  </button>
                </div>
              </div>

              {/* Import block */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    2. Importer / Restaurer une sauvegarde
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Un aperçu détaillé s&apos;affiche avant toute modification de
                    la base.
                  </p>
                </div>

                {!backupPreview ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setBackupDragActive(true);
                    }}
                    onDragLeave={() => setBackupDragActive(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setBackupDragActive(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) void analyzeBackupFile(file);
                    }}
                    className={`border-2 border-dashed rounded-2xl p-5 sm:p-6 text-center transition ${
                      backupDragActive
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-slate-300 hover:border-slate-400 bg-slate-50/50"
                    }`}
                  >
                    <ArchiveRestore className="h-7 w-7 text-indigo-600 mx-auto mb-2" />
                    <p className="text-xs sm:text-sm font-semibold text-slate-800">
                      Sélectionnez ou déposez une archive{" "}
                      <code>.json.gz</code> (ou <code>.json</code>)
                    </p>
                    <label className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer">
                      <Upload className="h-3.5 w-3.5" />
                      <span>
                        {loading
                          ? "Analyse de l'archive..."
                          : "Choisir une sauvegarde"}
                      </span>
                      <input
                        type="file"
                        accept=".gz,.json,application/gzip,application/x-gzip,application/json"
                        disabled={loading}
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void analyzeBackupFile(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-900">
                          Aperçu de l&apos;archive : {backupFile?.name}
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          Exportée le{" "}
                          {new Date(backupPreview.exportedAt).toLocaleString(
                            "fr-FR"
                          )}{" "}
                          · {formatBytesKb(backupPreview.compressedBytes)} →{" "}
                          {formatBytesKb(backupPreview.uncompressedBytes)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={resetBackupSelection}
                        className="text-slate-500 hover:text-slate-800 p-1 cursor-pointer"
                        title="Changer de fichier"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="bg-white rounded-lg border border-slate-200 p-2">
                        <div className="text-slate-500">Tickets / Factures</div>
                        <div className="text-sm font-bold text-slate-900">
                          {backupPreview.archive.receipts}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {backupPreview.archive.items} lignes articles
                        </div>
                      </div>
                      <div className="bg-white rounded-lg border border-slate-200 p-2">
                        <div className="text-slate-500">Duels & Notes</div>
                        <div className="text-sm font-bold text-slate-900">
                          {backupPreview.archive.comparisons} duels
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {backupPreview.archive.productNotes} notes produit
                        </div>
                      </div>
                      <div className="bg-white rounded-lg border border-slate-200 p-2 col-span-2 sm:col-span-1">
                        <div className="text-slate-500">Autres</div>
                        <div className="text-sm font-bold text-slate-900">
                          {backupPreview.archive.dismissedSuggestions} ignorées
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {backupPreview.archive.syncSettings} réglage(s)
                        </div>
                      </div>
                    </div>

                    {/* Import Mode selector */}
                    <div className="space-y-2 pt-1">
                      <div className="font-semibold text-slate-800">
                        Mode d&apos;import :
                      </div>

                      <label
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer ${
                          backupMode === "merge"
                            ? "bg-emerald-50 border-emerald-300"
                            : "bg-white border-slate-200"
                        }`}
                      >
                        <input
                          type="radio"
                          name="backupMode"
                          checked={backupMode === "merge"}
                          onChange={() => {
                            setBackupMode("merge");
                            setConfirmReplace(false);
                          }}
                          className="mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-900">
                            Fusion sans perte (recommandé)
                          </div>
                          <div className="text-slate-600">
                            Ajoute{" "}
                            <strong>
                              +{backupPreview.mergeDiff.newReceipts} ticket(s)
                            </strong>{" "}
                            ({backupPreview.mergeDiff.skippedReceipts} doublon(s)
                            ignoré(s)),{" "}
                            <strong>
                              +{backupPreview.mergeDiff.newComparisons} duel(s)
                            </strong>{" "}
                            et fusionne notes/duels existants.
                          </div>
                        </div>
                      </label>

                      <label
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer ${
                          backupMode === "replace"
                            ? "bg-rose-50 border-rose-300"
                            : "bg-white border-slate-200"
                        }`}
                      >
                        <input
                          type="radio"
                          name="backupMode"
                          checked={backupMode === "replace"}
                          onChange={() => setBackupMode("replace")}
                          className="mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <div className="font-semibold text-rose-900">
                            Remplacement complet (écrasement total)
                          </div>
                          <div className="text-rose-800">
                            Supprime les{" "}
                            <strong>
                              {backupPreview.currentDb.receipts} ticket(s)
                            </strong>{" "}
                            et{" "}
                            <strong>
                              {backupPreview.currentDb.comparisons} duel(s)
                            </strong>{" "}
                            actuels puis restaure l&apos;archive à
                            l&apos;identique.
                          </div>
                        </div>
                      </label>

                      {backupMode === "replace" && (
                        <label className="flex items-center gap-2 rounded-lg bg-rose-100/80 border border-rose-300 px-3 py-2 text-rose-950 font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            checked={confirmReplace}
                            onChange={(e) =>
                              setConfirmReplace(e.target.checked)
                            }
                          />
                          <span>
                            Je confirme vouloir remplacer toute la base actuelle
                          </span>
                        </label>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={resetBackupSelection}
                        className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 font-medium text-slate-700 cursor-pointer"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        disabled={
                          loading ||
                          (backupMode === "replace" && !confirmReplace)
                        }
                        onClick={handleConfirmBackupImport}
                        className={`px-4 py-2 rounded-xl font-semibold text-white cursor-pointer disabled:opacity-50 ${
                          backupMode === "replace"
                            ? "bg-rose-600 hover:bg-rose-700"
                            : "bg-emerald-600 hover:bg-emerald-700"
                        }`}
                      >
                        {loading ? "Import en cours..." : "Confirmer l'import"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {backupError && (
                <div className="rounded-xl p-3.5 border bg-red-50 border-red-200 text-red-900 text-xs flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{backupError}</span>
                </div>
              )}

              {backupReport && (
                <div className="rounded-xl p-4 border bg-emerald-50 border-emerald-200 text-emerald-900 text-xs space-y-1">
                  <div className="font-bold text-sm flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>
                      {backupReport.mode === "replace"
                        ? "Restauration complète terminée !"
                        : "Fusion de la sauvegarde terminée !"}
                    </span>
                  </div>
                  <p>
                    {backupReport.insertedReceipts} ticket(s) importé(s) (
                    {backupReport.insertedItems} lignes),{" "}
                    {backupReport.skippedReceipts} doublon(s) ignoré(s),{" "}
                    {backupReport.insertedComparisons} duel(s) créé(s),{" "}
                    {backupReport.mergedComparisons} fusionné(s),{" "}
                    {backupReport.upsertedNotes} note(s) mise(s) à jour.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
