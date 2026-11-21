"use client";

import {
  useState,
  useMemo,
  type DragEvent,
  type ChangeEvent,
} from "react";
import {
  X,
  RefreshCw,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Globe,
  FileText,
  FolderSync,
  Sparkles,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";

interface SyncModalProps {
  open: boolean;
  onClose: () => void;
  onSyncSuccess: () => void;
  syncToken: string;
  hasSavedSession: boolean;
  lastSyncAt: string | null;
}

type SyncTab = "bookmarklet" | "server" | "pdf";

export function SyncModal({
  open,
  onClose,
  onSyncSuccess,
  syncToken,
  hasSavedSession: initialHasSavedSession,
  lastSyncAt,
}: SyncModalProps) {
  const [activeTab, setActiveTab] = useState<SyncTab>("bookmarklet");
  const [cookieOrCurl, setCookieOrCurl] = useState("");
  const [harText, setHarText] = useState("");
  const [saveSession, setSaveSession] = useState(true);
  const [hasSavedSession, setHasSavedSession] = useState(
    initialHasSavedSession
  );

  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<"bookmarklet" | "console" | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error";
    title: string;
    details?: string[];
  } | null>(null);

  const [targetOrigin, setTargetOrigin] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : ""
  );

  const cleanTargetOrigin = targetOrigin.trim().replace(/\/+$/, "");
  const isVercelPreviewUrl = /-git-[^.]+\.vercel\.app$/i.test(
    cleanTargetOrigin
  );
  const suggestedProdOrigin = isVercelPreviewUrl
    ? cleanTargetOrigin.replace(/-git-[^.]+\.vercel\.app$/i, ".vercel.app")
    : null;

  const bookmarkletSource = useMemo(() => {
    const tokenLiteral = JSON.stringify(syncToken);
    const originLiteral = JSON.stringify(cleanTargetOrigin);

    // Self-contained async script that runs inside https://www.carrefour.fr.
    // Uses text/plain + syncToken in JSON body to avoid CORS preflight.
    return `(async()=>{const O=${originLiteral};const T=${tokenLiteral};const box=document.createElement('div');box.style.cssText='position:fixed;bottom:20px;right:20px;z-index:999999;background:#0f172a;color:#fff;padding:16px 20px;border-radius:14px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.35);max-width:400px;';box.innerHTML='<b>Sync Carrefour -> App</b><div id="crf-sync-msg" style="margin-top:6px;color:#cbd5e1">Recherche des tickets...</div>';document.body.appendChild(box);const setMsg=(m)=>{const el=document.getElementById('crf-sync-msg');if(el)el.textContent=m;};try{const rx=/(?:https:\\/\\/www\\.carrefour\\.fr)?\\/mon-compte\\/mes-achats\\/en-magasin\\/(\\d{10,16})\\/(\\d{8})\\/(\\d+)\\/(\\d+-\\d+-\\d+)/g;const found=new Map();const scan=(txt)=>{let m;while((m=rx.exec(txt))!==null){const eid=m[2]+'-'+m[3]+'-'+m[4];if(!found.has(eid))found.set(eid,{gln:m[1],date:m[2],store:m[3],key:m[4],eid,url:'https://www.carrefour.fr/mon-compte/mes-achats/en-magasin/'+m[1]+'/'+m[2]+'/'+m[3]+'/'+m[4]});}};scan(document.documentElement.innerHTML);try{const r=await fetch('https://www.carrefour.fr/mon-compte/mes-achats/en-magasin',{credentials:'include'});if(r.ok)scan(await r.text());}catch{}const list=Array.from(found.values());if(!list.length){setMsg('Aucun ticket détecté sur cette page. Ouvrez Mes achats > En magasin puis relancez.');return;}setMsg(list.length+' ticket(s) détecté(s). Vérification des nouveaux...');const chk=await fetch(O+'/api/sync/check',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({syncToken:T,externalIds:list.map(x=>x.eid)})});if(!chk.ok)throw new Error('Auth app refusée ('+chk.status+')');const {missingExternalIds}=await chk.json();const missing=list.filter(x=>missingExternalIds.includes(x.eid));if(!missing.length){setMsg('Tous vos tickets ('+list.length+') sont déjà synchronisés !');return;}setMsg(missing.length+' nouveau(x) ticket(s) à rapatrier...');const files=[];for(let i=0;i<missing.length;i++){const t=missing[i];setMsg('Téléchargement '+(i+1)+'/'+missing.length+' : '+t.key);const candidates=[t.url+'/pdf',t.url+'?format=pdf'];try{const dr=await fetch(t.url,{credentials:'include'});if(dr.ok){const dh=await dr.text();const pm=dh.match(/(\\/[^"'\\s<>]+?(?:_ticket\\.pdf|\\/pdf(?:\\?[^"'\\s<>]*)?))/i);if(pm)candidates.unshift(pm[1].startsWith('http')?pm[1]:'https://www.carrefour.fr'+pm[1]);}}catch{}for(const u of candidates){try{const pr=await fetch(u,{credentials:'include'});if(!pr.ok)continue;const ab=await pr.arrayBuffer();const bytes=new Uint8Array(ab);if(bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70){let bin='';for(let j=0;j<bytes.length;j++)bin+=String.fromCharCode(bytes[j]);files.push({fileName:t.key+'_ticket.pdf',base64:btoa(bin)});break;}}catch{}}}if(!files.length){setMsg('Impossible de récupérer les PDF automatiquement. Téléchargez-les manuellement.');return;}let ins=0;let skp=0;for(let b=0;b<files.length;b+=5){const batch=files.slice(b,b+5);setMsg('Envoi lot '+(Math.floor(b/5)+1)+'/'+Math.ceil(files.length/5)+' ('+files.length+' PDF)...');const up=await fetch(O+'/api/receipts/upload',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({syncToken:T,source:'carrefour_sync',files:batch})});if(!up.ok)throw new Error('Upload refusé ('+up.status+')');const res=await up.json();ins+=(res.insertedCount||0);skp+=(res.skippedCount||0);}setMsg('Terminé ! '+ins+' nouveau(x) ticket(s) ajouté(s), '+skp+' déjà présent(s).');}catch(e){const msg=e&&e.message?String(e.message):String(e);if(/failed to fetch|networkerror|load failed/i.test(msg)){setMsg('Bloqué par CORS ou Vercel Deployment Protection. Utilisez votre URL Production (sans -git-main) et désactivez Vercel Authentication dans Settings > Deployment Protection.');}else{setMsg('Erreur: '+msg);}}})();`;
  }, [cleanTargetOrigin, syncToken]);

  const bookmarkletHref = `javascript:${encodeURIComponent(bookmarkletSource)}`;

  if (!open) return null;

  async function handleCopy(kind: "bookmarklet" | "console") {
    const text = kind === "bookmarklet" ? bookmarkletHref : bookmarkletSource;
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2200);
  }

  async function handleServerSync(useSavedOnly = false) {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/sync/carrefour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cookieOrCurl: useSavedOnly ? "" : cookieOrCurl,
          harText: harText || undefined,
          saveSession: useSavedOnly ? false : saveSession,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        blockedByBotProtection?: boolean;
        needsAuth?: boolean;
        message?: string;
        discoveredCount?: number;
        insertedCount?: number;
        skippedCount?: number;
        errors?: string[];
      };

      if (!useSavedOnly && saveSession && cookieOrCurl.trim()) {
        setHasSavedSession(true);
      }

      if (data.blockedByBotProtection) {
        setFeedback({
          type: "warning",
          title: "Carrefour bloque l'IP du serveur (Cloudflare / DataDome)",
          details: [
            data.message ??
              "Utilisez l'onglet Bookmarklet 1-clic depuis votre navigateur déjà connecté à carrefour.fr.",
            ...(data.errors ?? []),
          ],
        });
      } else if (data.needsAuth) {
        setFeedback({
          type: "warning",
          title: "Session Carrefour manquante ou expirée",
          details: [data.message ?? "Reconnectez-vous sur carrefour.fr."],
        });
      } else if (data.insertedCount && data.insertedCount > 0) {
        setFeedback({
          type: "success",
          title: `${data.insertedCount} nouveau(x) ticket(s) rapatrié(s) !`,
          details: [
            data.message ?? "",
            ...(data.errors ?? []),
          ].filter(Boolean),
        });
        onSyncSuccess();
      } else {
        setFeedback({
          type: data.ok ? "success" : "warning",
          title:
            data.message ??
            `${data.discoveredCount ?? 0} ticket(s) vérifié(s), aucun nouveau ticket.`,
          details: data.errors,
        });
      }
    } catch (err) {
      setFeedback({
        type: "error",
        title: "Erreur lors de la synchronisation",
        details: [err instanceof Error ? err.message : String(err)],
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleClearSession() {
    await fetch("/api/sync/carrefour", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearSession: true }),
    });
    setHasSavedSession(false);
    setCookieOrCurl("");
    setFeedback({
      type: "success",
      title: "Session Carrefour supprimée de la base.",
    });
  }

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
        errors?: string[];
        error?: string;
      };

      if (!res.ok) {
        setFeedback({
          type: "error",
          title: data.error ?? "Erreur lors de l'import PDF",
          details: data.errors,
        });
        return;
      }

      const inserted = data.insertedCount ?? 0;
      const skipped = data.skippedCount ?? 0;
      setFeedback({
        type: inserted > 0 ? "success" : "warning",
        title: `${inserted} nouveau(x) ticket(s) inséré(s), ${skipped} déjà présent(s) ignoré(s).`,
        details: data.errors,
      });
      if (inserted > 0) {
        onSyncSuccess();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        title: "Échec de l'envoi des fichiers PDF",
        details: [err instanceof Error ? err.message : String(err)],
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
        details: data.errors,
      });
      if (inserted > 0) {
        onSyncSuccess();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        title: "Erreur lors du scan local",
        details: [err instanceof Error ? err.message : String(err)],
      });
    } finally {
      setLoading(false);
    }
  }

  function handleHarFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setHarText(reader.result);
      }
    };
    reader.readAsText(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      void uploadPdfFiles(e.dataTransfer.files);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-blue-600" />
              Rapatrier les nouveaux tickets Carrefour
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Déduplication automatique : seuls les tickets absents de la base
              PostgreSQL sont importés.
              {lastSyncAt
                ? ` Dernière synchro : ${new Date(lastSyncAt).toLocaleString("fr-FR")}`
                : ""}
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

        {/* Tabs */}
        <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50/50 text-sm font-medium">
          <button
            onClick={() => {
              setActiveTab("bookmarklet");
              setFeedback(null);
            }}
            className={`py-3 px-3 flex items-center justify-center gap-1.5 border-b-2 transition cursor-pointer ${
              activeTab === "bookmarklet"
                ? "border-blue-600 text-blue-700 bg-white"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Sparkles className="h-4 w-4" />
            <span>Bookmarklet 1-clic</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("server");
              setFeedback(null);
            }}
            className={`py-3 px-3 flex items-center justify-center gap-1.5 border-b-2 transition cursor-pointer ${
              activeTab === "server"
                ? "border-blue-600 text-blue-700 bg-white"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Globe className="h-4 w-4" />
            <span>Session / cURL / HAR</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("pdf");
              setFeedback(null);
            }}
            className={`py-3 px-3 flex items-center justify-center gap-1.5 border-b-2 transition cursor-pointer ${
              activeTab === "pdf"
                ? "border-blue-600 text-blue-700 bg-white"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Import PDF / Dossier</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {activeTab === "bookmarklet" && (
            <div className="space-y-4">
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-900 space-y-2">
                <p className="font-semibold">
                  Contournement 100% fiable de Google Auth & Cloudflare/DataDome
                </p>
                <p className="text-blue-800 text-xs leading-relaxed">
                  Carrefour.fr bloque souvent les IP Vercel et exige Google Auth
                  / OTP. Ce bookmarklet s&apos;exécute directement dans votre
                  onglet Carrefour déjà connecté, vérifie quels tickets manquent
                  dans votre base, télécharge uniquement les nouveaux PDF et les
                  envoie ici.
                </p>
              </div>

              {isVercelPreviewUrl && (
                <div className="rounded-xl bg-amber-50 border border-amber-300 p-3.5 text-xs text-amber-950 space-y-2">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    URL de Preview Vercel détectée (<code>-git-...</code>)
                  </p>
                  <p className="text-amber-900 leading-relaxed">
                    Les URLs de branche Vercel (<code>*-git-main-*.vercel.app</code>)
                    ont la <strong>Deployment Protection</strong> activée par
                    défaut, ce qui redirige les requêtes depuis{" "}
                    <code>carrefour.fr</code> et bloque le Bookmarklet en CORS.
                    Utilisez votre URL <strong>Production</strong> (sans{" "}
                    <code>-git-main</code>) ou désactivez{" "}
                    <em>Vercel Authentication</em> dans{" "}
                    <strong>Project Settings → Deployment Protection</strong>.
                  </p>
                  {suggestedProdOrigin && (
                    <button
                      type="button"
                      onClick={() => setTargetOrigin(suggestedProdOrigin)}
                      className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer"
                    >
                      Basculer vers {suggestedProdOrigin}
                    </button>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  URL cible de votre application (domaine Production Vercel)
                </label>
                <input
                  type="url"
                  value={targetOrigin}
                  onChange={(e) => setTargetOrigin(e.target.value)}
                  placeholder="https://votre-app.vercel.app"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              </div>

              <div className="space-y-3 text-sm text-slate-700">
                <div className="flex items-start gap-3">
                  <span className="h-6 w-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <div className="space-y-2">
                    <p>
                      Glissez ce bouton dans votre barre de favoris (ou copiez
                      le script) :
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={bookmarkletHref}
                        onClick={(e) => e.preventDefault()}
                        draggable
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm cursor-grab active:cursor-grabbing"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Sync Tickets Carrefour
                      </a>
                      <button
                        type="button"
                        onClick={() => handleCopy("bookmarklet")}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer"
                      >
                        {copied === "bookmarklet" ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Favori copié !</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copier URL du favori</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy("console")}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer"
                      >
                        {copied === "console" ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Script console copié !</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copier pour Console F12</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="h-6 w-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <div className="space-y-1">
                    <p>
                      Connectez-vous avec votre compte Google sur Carrefour et
                      ouvrez vos achats en magasin :
                    </p>
                    <a
                      href="https://www.carrefour.fr/mon-compte/mes-achats/en-magasin"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-blue-600 hover:underline font-medium text-xs"
                    >
                      <span>
                        Ouvrir carrefour.fr/mon-compte/mes-achats/en-magasin
                      </span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="h-6 w-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <p>
                    Cliquez sur votre favori{" "}
                    <strong>Sync Tickets Carrefour</strong> (ou collez le script
                    dans la console F12). Revenez ici et cliquez sur{" "}
                    <strong>Actualiser</strong>.
                  </p>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    onSyncSuccess();
                    onClose();
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium cursor-pointer"
                >
                  Actualiser les données de l&apos;app
                </button>
              </div>
            </div>
          )}

          {activeTab === "server" && (
            <div className="space-y-4">
              {hasSavedSession && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3.5">
                  <div className="text-xs text-emerald-900">
                    <p className="font-semibold">
                      Une session Carrefour est enregistrée en base
                    </p>
                    <p className="text-emerald-700">
                      Vous pouvez tenter un rapatriement direct depuis Vercel en
                      1 clic.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleServerSync(true)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                    >
                      Synchroniser maintenant
                    </button>
                    <button
                      type="button"
                      onClick={handleClearSession}
                      className="px-2.5 py-1.5 rounded-lg border border-emerald-300 hover:bg-emerald-100 text-emerald-800 text-xs cursor-pointer"
                    >
                      Effacer
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Coller un <code>Copy as cURL</code> ou l&apos;en-tête{" "}
                  <code>Cookie</code> de carrefour.fr
                </label>
                <textarea
                  rows={4}
                  value={cookieOrCurl}
                  onChange={(e) => setCookieOrCurl(e.target.value)}
                  placeholder="curl 'https://www.carrefour.fr/mon-compte/mes-achats/en-magasin' -H 'cookie: ...'"
                  className="w-full rounded-xl border border-slate-300 p-3 text-xs font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Optionnel : importer un fichier <code>.har</code> capturé sur
                  carrefour.fr (extrait automatiquement les URLs de tickets)
                </label>
                <input
                  type="file"
                  accept=".har,application/json"
                  onChange={handleHarFileSelect}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-medium file:bg-slate-50 hover:file:bg-slate-100"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveSession}
                  onChange={(e) => setSaveSession(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>
                  Mémoriser ce cookie de session dans PostgreSQL pour les
                  prochaines synchronisations
                </span>
              </label>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-500 flex items-center gap-1">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Sous réserve que Cloudflare/DataDome ne bloque pas l&apos;IP
                  Vercel
                </span>
                <button
                  type="button"
                  disabled={loading || (!cookieOrCurl.trim() && !harText)}
                  onClick={() => handleServerSync(false)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                  />
                  <span>
                    {loading ? "Synchronisation..." : "Rapatrier les tickets"}
                  </span>
                </button>
              </div>
            </div>
          )}

          {activeTab === "pdf" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-8 text-center transition ${
                  dragActive
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-300 hover:border-slate-400 bg-slate-50/50"
                }`}
              >
                <Upload className="h-8 w-8 text-blue-600 mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-800">
                  Glissez-déposez un ou plusieurs tickets Carrefour (.pdf)
                </p>
                <p className="text-xs text-slate-500 mt-1 mb-4">
                  Ex : <code>3-8993-1157_ticket.pdf</code>,{" "}
                  <code>7-925-1315_ticket.pdf</code> — les doublons sont
                  automatiquement ignorés.
                </p>
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Choisir des fichiers PDF</span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        void uploadPdfFiles(e.target.files);
                      }
                    }}
                  />
                </label>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">
                    Synchroniser les PDF du dossier serveur
                  </p>
                  <p>
                    Scanne les fichiers <code>*_ticket.pdf</code> à la racine du
                    projet local.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSyncLocalFolder}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer disabled:opacity-50"
                >
                  <FolderSync className="h-4 w-4 text-blue-600" />
                  <span>Scanner le dossier</span>
                </button>
              </div>
            </div>
          )}

          {/* Feedback banner */}
          {feedback && (
            <div
              className={`rounded-xl p-4 border text-sm ${
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
                <div className="space-y-1">
                  <p className="font-semibold">{feedback.title}</p>
                  {feedback.details && feedback.details.length > 0 && (
                    <ul className="list-disc list-inside text-xs space-y-0.5 opacity-90">
                      {feedback.details.map((d, i) => (
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
