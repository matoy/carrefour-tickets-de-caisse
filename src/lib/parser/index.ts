import {
  parseCarrefourFromDocument,
  type ParsedReceipt,
} from "./carrefour-pdf";
import { parseMonoprixFromDocument } from "./monoprix-pdf";
import { extractPdfDocument } from "./pdf-text";

export type {
  ParsedReceipt,
  ParsedReceiptItem,
  Retailer,
} from "./carrefour-pdf";

/**
 * Auto-detect whether a PDF buffer is a Monoprix Courses invoice or a Carrefour ticket
 * and parse it accordingly.
 */
export async function parseReceiptPdf(
  buffer: Buffer,
  fileName?: string
): Promise<ParsedReceipt> {
  const doc = await extractPdfDocument(buffer);
  const joinedText = doc.allLines.join("\n");

  const isMonoprix =
    /MONOPRIX\.fr|Monoprix\s+Exploitation|N°\s*de\s*facture\s*:/i.test(
      joinedText
    );

  if (isMonoprix) {
    return parseMonoprixFromDocument(doc, fileName);
  }

  return parseCarrefourFromDocument(doc, fileName);
}
