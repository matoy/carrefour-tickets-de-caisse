import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import { parseReceiptPdf } from "@/lib/parser";
import {
  insertParsedReceiptIfNew,
  setSyncSetting,
  type UpsertResult,
} from "@/lib/db/receipt-service";

export async function POST(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const allEntries = [
      ...formData.getAll("files"),
      ...formData.getAll("file"),
    ];

    const fileBuffers: Array<{ name: string; buffer: Buffer }> = [];
    for (const entry of allEntries) {
      if (entry instanceof File) {
        const arrayBuffer = await entry.arrayBuffer();
        fileBuffers.push({
          name: entry.name || "ticket.pdf",
          buffer: Buffer.from(arrayBuffer),
        });
      }
    }

    if (fileBuffers.length === 0) {
      return NextResponse.json(
        { error: "Aucun fichier PDF fourni" },
        { status: 400 }
      );
    }

    const results: UpsertResult[] = [];
    const errors: string[] = [];

    for (const item of fileBuffers) {
      try {
        const parsed = await parseReceiptPdf(item.buffer, item.name);
        const res = await insertParsedReceiptIfNew(parsed, "pdf_upload");
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

    return NextResponse.json({
      ok: errors.length === 0 || insertedCount > 0,
      insertedCount,
      skippedCount,
      results,
      errors,
    });
  } catch (err) {
    console.error("POST /api/receipts/upload error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Erreur lors de l'import PDF",
      },
      { status: 500 }
    );
  }
}
