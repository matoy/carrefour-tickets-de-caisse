export interface DiscoveredCarrefourTicket {
  gln: string;
  date: string;
  storeCode: string;
  ticketKey: string;
  detailUrl: string;
  pdfUrl: string;
  externalId: string;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Parse either raw Cookie header string or a "Copy as cURL" snippet into headers & cookie string.
 */
export function extractHeadersFromInput(input: string): {
  cookieHeader: string;
  extraHeaders: Record<string, string>;
} {
  const trimmed = input.trim();
  const extraHeaders: Record<string, string> = {};

  if (/^curl\s+/i.test(trimmed)) {
    const headerRegex = /-H\s+['"]([^'"]+)['"]/gi;
    let match: RegExpExecArray | null;
    while ((match = headerRegex.exec(trimmed)) !== null) {
      const idx = match[1].indexOf(":");
      if (idx > 0) {
        const key = match[1].slice(0, idx).trim();
        const val = match[1].slice(idx + 1).trim();
        extraHeaders[key.toLowerCase()] = val;
      }
    }

    const cookieFlagRegex = /(?:-b|--cookie)\s+['"]([^'"]+)['"]/i;
    const cookieFlagMatch = trimmed.match(cookieFlagRegex);
    const cookieHeader =
      cookieFlagMatch?.[1] ?? extraHeaders["cookie"] ?? "";
    delete extraHeaders["cookie"];
    return { cookieHeader, extraHeaders };
  }

  // Raw cookie string (remove leading "Cookie:" if pasted)
  const cleanCookie = trimmed.replace(/^cookie:\s*/i, "");
  return { cookieHeader: cleanCookie, extraHeaders };
}

/**
 * Discover Carrefour in-store receipt links from HTML, JSON, or HAR text.
 * Matches patterns like:
 * /mon-compte/mes-achats/en-magasin/3021080622705/20261101/7837/3-8993-1157
 */
export function discoverTicketLinksFromText(
  text: string
): DiscoveredCarrefourTicket[] {
  const seen = new Map<string, DiscoveredCarrefourTicket>();
  const regex =
    /(?:https:\/\/www\.carrefour\.fr)?\/mon-compte\/mes-achats\/en-magasin\/(\d{10,16})\/(\d{8})\/(\d+)\/(\d+-\d+-\d+)/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const gln = match[1];
    const date = match[2];
    const storeCode = match[3];
    const ticketKey = match[4];
    const externalId = `${date}-${storeCode}-${ticketKey}`;

    if (!seen.has(externalId)) {
      const detailUrl = `https://www.carrefour.fr/mon-compte/mes-achats/en-magasin/${gln}/${date}/${storeCode}/${ticketKey}`;
      const pdfUrl = `${detailUrl}/pdf`;
      seen.set(externalId, {
        gln,
        date,
        storeCode,
        ticketKey,
        detailUrl,
        pdfUrl,
        externalId,
      });
    }
  }

  return Array.from(seen.values());
}

/**
 * Also look for PDF direct links inside a receipt detail HTML page.
 */
export function extractPdfUrlsFromHtml(html: string): string[] {
  const urls = new Set<string>();
  const regex =
    /(?:https:\/\/www\.carrefour\.fr)?(\/[^"'\s<>]+?(?:_ticket\.pdf|\/pdf(?:\?[^"'\s<>]*)?|telecharger[^"'\s<>]*))/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const pathOrUrl = match[1];
    urls.add(
      pathOrUrl.startsWith("http")
        ? pathOrUrl
        : `https://www.carrefour.fr${pathOrUrl}`
    );
  }
  return Array.from(urls);
}

export interface CarrefourFetchResult {
  ok: boolean;
  blockedByBotProtection: boolean;
  needsAuth: boolean;
  statusCode: number;
  message: string;
  discoveredTickets: DiscoveredCarrefourTicket[];
  downloadedPdfs: Array<{
    externalId: string;
    ticketKey: string;
    fileName: string;
    buffer: Buffer;
  }>;
  errors: string[];
}

function buildBrowserHeaders(
  cookieHeader: string,
  extraHeaders: Record<string, string>
): HeadersInit {
  return {
    "user-agent": extraHeaders["user-agent"] ?? DEFAULT_USER_AGENT,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
    "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    referer: "https://www.carrefour.fr/mon-compte/mes-achats/en-magasin",
    cookie: cookieHeader,
    ...extraHeaders,
  };
}

function isBotChallenge(status: number, body: string): boolean {
  if (status === 403 || status === 429 || status === 503) {
    if (
      /cloudflare|cf-browser-verification|datadome|captcha-delivery|just a moment|attention required/i.test(
        body
      )
    ) {
      return true;
    }
  }
  return /datadome|cf-chl-|challenge-platform/i.test(body);
}

export interface ExtractedHarData {
  isValidHar: boolean;
  totalEntryCount: number;
  carrefourEntryCount: number;
  cookieHeader: string;
  userAgent: string | null;
  embeddedPdfs: CarrefourFetchResult["downloadedPdfs"];
}

/**
 * Extract Carrefour session cookies, user-agent, and any embedded PDF responses from a HAR file.
 */
export function extractDataFromHar(harText: string): ExtractedHarData {
  const empty: ExtractedHarData = {
    isValidHar: false,
    totalEntryCount: 0,
    carrefourEntryCount: 0,
    cookieHeader: "",
    userAgent: null,
    embeddedPdfs: [],
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(harText);
  } catch {
    return empty;
  }

  const entries = (
    parsed as { log?: { entries?: Array<Record<string, unknown>> } }
  )?.log?.entries;
  if (!Array.isArray(entries)) {
    return empty;
  }

  let cookieHeader = "";
  let userAgent: string | null = null;
  let carrefourEntryCount = 0;
  const embeddedPdfs: CarrefourFetchResult["downloadedPdfs"] = [];
  const seenPdfNames = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as {
      request?: {
        url?: string;
        headers?: Array<{ name?: string; value?: string }>;
        cookies?: Array<{ name?: string; value?: string }>;
      };
      response?: {
        headers?: Array<{ name?: string; value?: string }>;
        content?: {
          mimeType?: string;
          encoding?: string;
          text?: string;
        };
      };
    };

    const url = String(entry?.request?.url ?? "");
    let isCarrefour = false;
    try {
      isCarrefour = /(?:^|\.)carrefour\.fr$/i.test(new URL(url).hostname);
    } catch {
      isCarrefour = false;
    }

    if (isCarrefour) {
      carrefourEntryCount++;

      for (const h of entry?.request?.headers ?? []) {
        const name = String(h?.name ?? "").toLowerCase();
        const value = String(h?.value ?? "");
        if (name === "cookie" && value.length > cookieHeader.length) {
          cookieHeader = value;
        }
        if (name === "user-agent" && !userAgent && value) {
          userAgent = value;
        }
      }

      if (Array.isArray(entry?.request?.cookies) && entry.request.cookies.length > 0) {
        const joined = entry.request.cookies
          .filter((c) => c?.name && c.value !== undefined)
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        if (joined.length > cookieHeader.length) {
          cookieHeader = joined;
        }
      }
    }

    const content = entry?.response?.content;
    const text = content?.text;
    if (typeof text === "string" && text.length > 100) {
      const mimeType = String(content?.mimeType ?? "").toLowerCase();
      const encoding = String(content?.encoding ?? "").toLowerCase();
      const looksLikePdf =
        mimeType.includes("pdf") ||
        text.startsWith("JVBERi0") ||
        text.startsWith("%PDF-");

      if (looksLikePdf) {
        const buf =
          encoding === "base64" || text.startsWith("JVBERi0")
            ? Buffer.from(text, "base64")
            : Buffer.from(text, "latin1");
        if (buf.subarray(0, 5).toString("ascii") === "%PDF-") {
          const urlMatch = url.match(
            /\/en-magasin\/\d+\/(\d{8})\/(\d+)\/(\d+-\d+-\d+)/
          );
          let fileName = urlMatch
            ? `${urlMatch[3]}_ticket.pdf`
            : `har_ticket_${i + 1}.pdf`;
          for (const rh of entry?.response?.headers ?? []) {
            if (String(rh?.name ?? "").toLowerCase() === "content-disposition") {
              const fnMatch = String(rh?.value ?? "").match(
                /filename[^;=\n]*=\s*["']?([^"';\n]+)["']?/i
              );
              if (fnMatch?.[1]) {
                fileName = fnMatch[1].trim();
              }
            }
          }
          if (!seenPdfNames.has(fileName)) {
            seenPdfNames.add(fileName);
            const ticketKey = urlMatch?.[3] ?? fileName.replace(/_ticket\.pdf$/i, "");
            const externalId = urlMatch
              ? `${urlMatch[1]}-${urlMatch[2]}-${urlMatch[3]}`
              : fileName;
            embeddedPdfs.push({
              externalId,
              ticketKey,
              fileName,
              buffer: buf,
            });
          }
        }
      }
    }
  }

  return {
    isValidHar: true,
    totalEntryCount: entries.length,
    carrefourEntryCount,
    cookieHeader,
    userAgent,
    embeddedPdfs,
  };
}

/**
 * Attempt to fetch Carrefour in-store receipts list and download PDFs for new tickets.
 */
export async function syncFromCarrefourSession(params: {
  cookieOrCurl: string;
  existingExternalIds: Set<string>;
  extraHarText?: string;
}): Promise<CarrefourFetchResult> {
  const { cookieHeader: inputCookie, extraHeaders } = extractHeadersFromInput(
    params.cookieOrCurl
  );

  const harData = params.extraHarText?.trim()
    ? extractDataFromHar(params.extraHarText)
    : null;

  const cookieHeader = inputCookie || harData?.cookieHeader || "";
  if (!extraHeaders["user-agent"] && harData?.userAgent) {
    extraHeaders["user-agent"] = harData.userAgent;
  }

  const discovered = new Map<string, DiscoveredCarrefourTicket>();
  if (params.extraHarText) {
    for (const t of discoverTicketLinksFromText(params.extraHarText)) {
      discovered.set(t.externalId, t);
    }
  }
  for (const t of discoverTicketLinksFromText(params.cookieOrCurl)) {
    discovered.set(t.externalId, t);
  }

  const embeddedPdfs = (harData?.embeddedPdfs ?? []).filter(
    (pdf) => !params.existingExternalIds.has(pdf.externalId)
  );

  if (!cookieHeader) {
    if (embeddedPdfs.length > 0) {
      return {
        ok: true,
        blockedByBotProtection: false,
        needsAuth: false,
        statusCode: 200,
        message: `${embeddedPdfs.length} PDF extrait(s) directement depuis le fichier .har.`,
        discoveredTickets: Array.from(discovered.values()),
        downloadedPdfs: embeddedPdfs,
        errors: [],
      };
    }

    const harDiagnostic = harData
      ? harData.isValidHar
        ? `Le fichier .har contient ${harData.totalEntryCount} requête(s) (dont ${harData.carrefourEntryCount} vers carrefour.fr), mais aucun cookie de session ni PDF intégré. Par défaut, Chrome retire les cookies des exports .har (ou la page n'a pas été rechargée avec F5 pendant la capture). Utilisez plutôt « Copy as cURL » sur une requête carrefour.fr ou le Bookmarklet 1-clic.`
        : "Le fichier .har fourni n'est pas un JSON HAR valide."
      : "Aucun cookie de session Carrefour fourni. Utilisez le Bookmarklet 1-clic depuis carrefour.fr ou collez un Copy as cURL / Cookie.";

    return {
      ok: false,
      blockedByBotProtection: false,
      needsAuth: true,
      statusCode: 400,
      message: harDiagnostic,
      discoveredTickets: Array.from(discovered.values()),
      downloadedPdfs: [],
      errors: [],
    };
  }

  const headers = buildBrowserHeaders(cookieHeader, extraHeaders);
  const candidateListUrls = [
    "https://www.carrefour.fr/mon-compte/mes-achats/en-magasin",
    "https://www.carrefour.fr/mon-compte/mes-achats",
    "https://www.carrefour.fr/api/my-account/orders/in-store",
    "https://www.carrefour.fr/api/v1/my-account/receipts",
  ];

  let lastStatus = 200;
  let botBlocked = false;
  let authNeeded = false;
  const errors: string[] = [];

  for (const url of candidateListUrls) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        redirect: "manual",
      });
      lastStatus = res.status;

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location") ?? "";
        if (/connexion|login|oauth|auth/i.test(loc)) {
          authNeeded = true;
        }
        continue;
      }

      const text = await res.text();
      if (isBotChallenge(res.status, text)) {
        botBlocked = true;
        break;
      }

      if (res.status === 401) {
        authNeeded = true;
        continue;
      }

      if (res.ok) {
        for (const t of discoverTicketLinksFromText(text)) {
          discovered.set(t.externalId, t);
        }
      }
    } catch (err) {
      errors.push(
        `Erreur réseau sur ${url}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (botBlocked) {
    return {
      ok: false,
      blockedByBotProtection: true,
      needsAuth: false,
      statusCode: lastStatus,
      message:
        "Carrefour.fr a bloqué l'IP du serveur via Cloudflare / DataDome. Utilisez le Bookmarklet 1-clic directement depuis votre navigateur connecté sur carrefour.fr, ou importez vos PDF.",
      discoveredTickets: Array.from(discovered.values()),
      downloadedPdfs: [],
      errors,
    };
  }

  if (authNeeded && discovered.size === 0) {
    return {
      ok: false,
      blockedByBotProtection: false,
      needsAuth: true,
      statusCode: lastStatus,
      message:
        "La session Carrefour a expiré ou les cookies sont invalides. Reconnectez-vous sur carrefour.fr puis relancez le Bookmarklet ou mettez à jour vos cookies.",
      discoveredTickets: [],
      downloadedPdfs: [],
      errors,
    };
  }

  const allDiscovered = Array.from(discovered.values());
  const downloadedPdfs: CarrefourFetchResult["downloadedPdfs"] = [
    ...embeddedPdfs,
  ];
  const alreadyExtractedIds = new Set(embeddedPdfs.map((p) => p.externalId));
  const missingTickets = allDiscovered.filter(
    (t) =>
      !params.existingExternalIds.has(t.externalId) &&
      !alreadyExtractedIds.has(t.externalId)
  );

  for (const ticket of missingTickets) {
    const candidatePdfUrls = [
      ticket.pdfUrl,
      `${ticket.detailUrl}?format=pdf`,
      `https://www.carrefour.fr/api/my-account/orders/in-store/${ticket.gln}/${ticket.date}/${ticket.storeCode}/${ticket.ticketKey}/pdf`,
    ];

    try {
      // Also inspect the detail page HTML to discover the exact PDF download URL
      const detailRes = await fetch(ticket.detailUrl, {
        method: "GET",
        headers,
      });
      if (detailRes.ok) {
        const html = await detailRes.text();
        if (isBotChallenge(detailRes.status, html)) {
          botBlocked = true;
          break;
        }
        for (const extracted of extractPdfUrlsFromHtml(html)) {
          if (!candidatePdfUrls.includes(extracted)) {
            candidatePdfUrls.unshift(extracted);
          }
        }
      }

      let fetchedPdf: Buffer | null = null;
      for (const pdfUrl of candidatePdfUrls) {
        const pdfRes = await fetch(pdfUrl, {
          method: "GET",
          headers: {
            ...headers,
            accept: "application/pdf,*/*",
          },
        });
        if (!pdfRes.ok) continue;
        const ct = pdfRes.headers.get("content-type") ?? "";
        const buf = Buffer.from(await pdfRes.arrayBuffer());
        if (
          ct.includes("pdf") ||
          buf.subarray(0, 5).toString("ascii") === "%PDF-"
        ) {
          fetchedPdf = buf;
          break;
        }
      }

      if (fetchedPdf) {
        downloadedPdfs.push({
          externalId: ticket.externalId,
          ticketKey: ticket.ticketKey,
          fileName: `${ticket.ticketKey}_ticket.pdf`,
          buffer: fetchedPdf,
        });
      } else {
        errors.push(`Impossible de télécharger le PDF pour ${ticket.ticketKey}`);
      }
    } catch (err) {
      errors.push(
        `Échec sur ${ticket.ticketKey}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return {
    ok: !botBlocked && (allDiscovered.length > 0 || downloadedPdfs.length > 0),
    blockedByBotProtection: botBlocked,
    needsAuth: authNeeded,
    statusCode: lastStatus,
    message: botBlocked
      ? "Blocage anti-bot détecté pendant le téléchargement des PDF. Utilisez le Bookmarklet navigateur 1-clic."
      : allDiscovered.length === 0
      ? "Aucun lien de ticket trouvé dans la page Carrefour avec cette session. Utilisez le Bookmarklet 1-clic depuis la page Mes achats en magasin."
      : `${allDiscovered.length} ticket(s) détecté(s), ${missingTickets.length} manquant(s), ${downloadedPdfs.length} PDF téléchargé(s).`,
    discoveredTickets: allDiscovered,
    downloadedPdfs,
    errors,
  };
}
