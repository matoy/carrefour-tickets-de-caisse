const ABBREVIATION_EXPANSIONS: Array<[RegExp, string]> = [
  [/\bS\/LACT\b/gi, "SANS LACTOSE"],
  [/\bORAN\b/gi, "ORANGE"],
  [/\bFLT\b/gi, "FILET"],
  [/\bDCH\b/gi, "DOUCHE"],
  [/\bBQ\b/gi, "BARQUETTE"],
  [/\bTOM\b/gi, "TOMATE"],
  [/\bOIGN\b/gi, "OIGNON"],
  [/\bJNE\b/gi, "JAUNE"],
  [/\bESSUIE TT\b/gi, "ESSUIE TOUT"],
  [/\bCRF\b/gi, "CARREFOUR"],
  [/\bPCE\b/gi, "PIECE"],
  [/\bVEL\b/gi, "VELOUTE"],
  [/\bGRD\b/gi, "GOURDE"],
  [/\bPOM\b/gi, "POMME"],
  [/\bSSA\b/gi, "SANS SUCRES AJOUTES"],
  [/\bPEP\b/gi, "PEPITES"],
  [/\bRISOTO\b/gi, "RISOTTO"],
  [/\bMANGO\b/gi, "MANGUE"],
  [/\bCHOCO\.?L?\b/gi, "CHOCOLAT"],
  [/\bGUERA\b/gi, "GUERANDE"],
  [/\bHARIB\b/gi, "HARIBO"],
  [/\bBERRIE\b/gi, "BERRIES"],
  [/\bALL\b/gi, "ALLONGEE"],
  [/\bFQC\b/gi, "FILIERE QUALITE CARREFOUR"],
  [/\bBL\b/gi, "BLANC"],
  [/\b2P\b/gi, "2 PLIS"],
  [/\bMXW\b/gi, "MAXWELL"],
  [/\bML\b/gi, "MATIN LEGER"],
  [/\bLA\b/gi, "LACTEL"],
  [/\bFR\b/gi, "FRANCE"],
  [/\bBROCOLIS\b/gi, "BROCOLI"],
];

const STOPWORDS_FOR_MATCHING = new Set([
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "l",
  "d",
  "au",
  "aux",
  "en",
  "et",
  "a",
  "pour",
  "avec",
  "sans",
  "monoprix",
  "carrefour",
  "crf",
  "bio",
  "fqc",
  "filiere",
  "qualite",
  "france",
  "vrac",
  "piece",
  "pce",
  "barquette",
  "bq",
  "filet",
  "flt",
  "paquet",
  "format",
  "familial",
  "pots",
  "pot",
  "x",
  "kg",
  "g",
  "l",
  "ml",
  "cl",
]);

/**
 * Remove accents and normalize whitespace/casing for search and matching.
 */
export function stripAccents(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Expand common Carrefour receipt abbreviations into a searchable normalized label.
 */
export function buildNormalizedLabel(rawLabel: string): string {
  let expanded = rawLabel.replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of ABBREVIATION_EXPANSIONS) {
    expanded = expanded.replace(pattern, replacement);
  }
  const combined =
    expanded.toUpperCase() === rawLabel.toUpperCase()
      ? expanded
      : `${rawLabel} ${expanded}`;
  return stripAccents(combined);
}

/**
 * Extract meaningful normalized keywords from a product label for cross-retailer pairing.
 */
export function extractMatchTokens(
  rawLabel: string,
  normalizedLabel: string
): string[] {
  const base = stripAccents(`${rawLabel} ${normalizedLabel}`)
    .replace(/['’.,/()*+-]/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|mn|mois)\b/gi, " ")
    .replace(/\bx\d+\b/gi, " ")
    .replace(/\b\d+x\b/gi, " ")
    .replace(/\b\d+\b/g, " ");

  const tokens = new Set<string>();
  for (const rawTok of base.split(/\s+/)) {
    const tok = rawTok.trim();
    if (tok.length < 3) continue;
    if (STOPWORDS_FOR_MATCHING.has(tok)) continue;
    const singular = tok.endsWith("s") && tok.length > 4 ? tok.slice(0, -1) : tok;
    if (STOPWORDS_FOR_MATCHING.has(singular)) continue;
    tokens.add(singular);
  }
  return Array.from(tokens);
}

export interface PackageMetrics {
  weightKg: number | null;
  volumeL: number | null;
  unitType: "kg" | "L" | "piece";
}

function toKgOrL(
  amount: number,
  unit: string
): { weightKg: number | null; volumeL: number | null; unitType: "kg" | "L" } {
  const upper = unit.toUpperCase();
  if (upper === "KG") {
    return { weightKg: amount, volumeL: null, unitType: "kg" };
  }
  if (upper === "G") {
    return { weightKg: amount / 1000, volumeL: null, unitType: "kg" };
  }
  if (upper === "L") {
    return { weightKg: null, volumeL: amount, unitType: "L" };
  }
  if (upper === "CL") {
    return { weightKg: null, volumeL: amount / 100, unitType: "L" };
  }
  // ML
  return { weightKg: null, volumeL: amount / 1000, unitType: "L" };
}

/**
 * Extract weight (kg) or volume (L) embedded in a product label,
 * multiplied by the purchased quantity.
 */
export function extractPackageMetrics(
  rawLabel: string,
  quantity: number
): PackageMetrics {
  const multiMatch = rawLabel.match(
    /(?<![xX])\b(\d+)\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*(KG|G|L|ML|CL)\b/i
  );
  if (multiMatch) {
    const count = Number(multiMatch[1]);
    const singleAmount = Number(multiMatch[2].replace(",", "."));
    const totalAmount = count * singleAmount * quantity;
    if (Number.isFinite(totalAmount) && totalAmount > 0) {
      return toKgOrL(totalAmount, multiMatch[3]);
    }
  }

  const singleMatch = rawLabel.match(
    /\b(\d+(?:[.,]\d+)?)\s*(KG|G|L|ML|CL)\b/i
  );
  if (singleMatch) {
    const singleAmount = Number(singleMatch[1].replace(",", "."));
    const totalAmount = singleAmount * quantity;
    if (Number.isFinite(totalAmount) && totalAmount > 0) {
      return toKgOrL(totalAmount, singleMatch[2]);
    }
  }

  return { weightKg: null, volumeL: null, unitType: "piece" };
}

/**
 * Mask any Carrefour loyalty card numbers (e.g. 913572...) before storing/displaying.
 */
export function maskLoyaltyCards(text: string): string {
  return text.replace(/\b913572\d{6,15}\b/g, (match) => {
    const tail = match.slice(-4);
    return `913572*********${tail}`;
  });
}

/**
 * Mask personal info (loyalty cards, customer name, email, delivery address) before storing rawText.
 */
export function maskPersonalInfo(text: string): string {
  let masked = maskLoyaltyCards(text);
  masked = masked.replace(
    /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    "***@$2"
  );
  masked = masked.replace(
    /^(Nom\s+du\s+client\s*:\s*).+$/gim,
    "$1[MASQUE]"
  );
  masked = masked.replace(
    /^(Votre\s+e-?mail\s*:\s*).+$/gim,
    "$1[MASQUE]"
  );
  masked = masked.replace(
    /^(\d{1,4}\s+(?:Rue|Avenue|Boulevard|All[ée]e|Impasse|Place|Chemin)\b.+)$/gim,
    "[ADRESSE MASQUEE]"
  );
  return masked;
}
