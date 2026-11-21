import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import { parseCarrefourReceiptPdf } from "@/lib/parser/carrefour-pdf";
import {
  insertParsedReceiptIfNew,
  setSyncSetting,
  type UpsertResult,
} from "@/lib/db/receipt-service";

function getCorsHeaders(request: NextRequest): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  const allowedOrigin =
    origin === "https://www.carrefour.fr" || origin === "https://carrefour.fr"
      ? origin
      : "https://www.carrefour.fr";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-sync-token",
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

export async function POST(request: NextRequest) {
  const cors = getCorsHeaders(request);

  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json(
      { error: "Non autorisé" },
      { status: 401, headers: cors }
    );
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";
    const fileBuffers: Array<{
      name: string;
      buffer: Buffer;
      source: "carrefour_sync" | "pdf_upload";
    }> = [];

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        source?: "carrefour_sync" | "pdf_upload";
        files?: Array<{ fileName: string; base64: string }>;
      };
      const source =
        body.source === "carrefour_sync" ? "carrefour_sync" : "pdf_upload";
      for (const f of body.files ?? []) {
        if (!f.base64) continue;
        const cleanBase64 = f.base64.includes(",")
          ? f.base64.split(",")[1]
          : f.base64;
        fileBuffers.push({
          name: f.fileName || "ticket.pdf",
          buffer: Buffer.from(cleanBase64, "base64"),
          source,
        });
      }
    } else {
      const formData = await request.formData();
      const allEntries = [
        ...formData.getAll("files"),
        ...formData.getAll("file"),
      ];
      for (const entry of allEntries) {
        if (entry instanceof File) {
          const arrayBuffer = await entry.arrayBuffer();
          fileBuffers.push({
            name: entry.name || "ticket.pdf",
            buffer: Buffer.from(arrayBuffer),
            source: "pdf_upload",
          });
        }
      }
    }

    if (fileBuffers.length === 0) {
      return NextResponse.json(
        { error: "Aucun fichier PDF fourni" },
        { status: 400, headers: cors }
      );
    }

    const results: UpsertResult[] = [];
    const errors: string[] = [];

    for (const item of fileBuffers) {
      try {
        const parsed = await parseCarrefourReceiptPdf(item.buffer, item.name);
        const res = await insertParsedReceiptIfNew(parsed, item.source);
        results.push(res);
      } catch (err) {
        errors.push(
          `${item.name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const insertedCount = results.filter((r) => r.inserted).length;
    const skippedCount = results.filter((r) => r.skipped).length;

    if (insertedCount > 0) {
      await setSyncSetting("last_sync_at", new Date().toISOString());
    }

    return NextResponse.json(
      {
        ok: errors.length === 0 || insertedCount > 0,
        insertedCount,
        skippedCount,
        results,
        errors,
      },
      { headers: cors }
    );
  } catch (err) {
    console.error("POST /api/receipts/upload error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Erreur lors de l'import PDF",
      },
      { status: 500, headers: cors }
    );
  }
}
