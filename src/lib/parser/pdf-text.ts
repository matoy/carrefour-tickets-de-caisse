import path from "node:path";
import { pathToFileURL } from "node:url";

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

export interface PdfPageData {
  pageNumber: number;
  items: PdfTextItem[];
  lines: string[];
}

export interface ExtractedPdfDocument {
  pages: PdfPageData[];
  allLines: string[];
}

/**
 * Group positioned text items on a PDF page into visual lines ordered top-to-bottom.
 */
export function groupTextItemsIntoLines(
  rawItems: PdfTextItem[],
  yTolerance = 2.8
): string[] {
  const sorted = [...rawItems].sort((a, b) => {
    if (Math.abs(a.y - b.y) > yTolerance) return b.y - a.y;
    return a.x - b.x;
  });

  const lineGroups: Array<{ y: number; items: PdfTextItem[] }> = [];
  for (const item of sorted) {
    const existing = lineGroups.find(
      (g) => Math.abs(g.y - item.y) <= yTolerance
    );
    if (existing) {
      existing.items.push(item);
    } else {
      lineGroups.push({ y: item.y, items: [item] });
    }
  }

  const lines: string[] = [];
  for (const group of lineGroups) {
    group.items.sort((a, b) => a.x - b.x);
    const lineText = group.items
      .map((i) => i.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (lineText) {
      lines.push(lineText);
    }
  }

  return lines;
}

/**
 * Extract positioned text items and visual lines from every page of a PDF buffer.
 */
export async function extractPdfDocument(
  buffer: Buffer
): Promise<ExtractedPdfDocument> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerPath = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs"
  );
  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  });

  const pdf = await loadingTask.promise;
  const pages: PdfPageData[] = [];
  const allLines: string[] = [];

  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const rawItems: PdfTextItem[] = [];

      for (const item of textContent.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const transform = item.transform;
        rawItems.push({
          str: item.str.trim(),
          x: transform[4],
          y: transform[5],
          width: typeof item.width === "number" ? item.width : 0,
        });
      }

      const lines = groupTextItemsIntoLines(rawItems);
      pages.push({ pageNumber: pageNum, items: rawItems, lines });
      allLines.push(...lines);
    }
  } finally {
    if (typeof pdf.cleanup === "function") {
      await pdf.cleanup();
    }
    await loadingTask.destroy();
  }

  return { pages, allLines };
}
