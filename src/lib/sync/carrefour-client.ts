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

/**
 * Attempt to fetch Carrefour in-store receipts list and download PDFs for new tickets.
 */
export async function syncFromCarrefourSession(params: {
  cookieOrCurl: string;
  existingExternalIds: Set<string>;
  extraHarText?: string;
}): Promise<CarrefourFetchResult> {
  const { cookieHeader, extraHeaders } = extractHeadersFromInput(
    params.cookieOrCurl
  );

  const discovered = new Map<string, DiscoveredCarrefourTicket>();
  if (params.extraHarText) {
    for (const t of discoverTicketLinksFromText(params.extraHarText)) {
      discovered.set(t.externalId, t);
    }
  }
  for (const t of discoverTicketLinksFromText(params.cookieOrCurl)) {
    discovered.set(t.externalId, t);
  }

  if (!cookieHeader) {
    return {
      ok: false,
      blockedByBotProtection: false,
      needsAuth: true,
      statusCode: 400,
      message:
        "Aucun cookie de session Carrefour fourni. Utilisez le Bookmarklet 1-clic depuis carrefour.fr ou collez un Copy as cURL / Cookie.",
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
  const missingTickets = allDiscovered.filter(
    (t) => !params.existingExternalIds.has(t.externalId)
  );

  const downloadedPdfs: CarrefourFetchResult["downloadedPdfs"] = [];

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
