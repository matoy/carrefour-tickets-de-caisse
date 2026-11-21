import { NextRequest, NextResponse } from "next/server";
import {
  createBookmarkletToken,
  isApiRequestAuthenticated,
  isAuthEnabled,
} from "@/lib/auth";
import { ensureDbInitialized } from "@/lib/db";
import { receipts } from "@/lib/db/schema";
import {
  getSyncSetting,
  insertParsedReceiptIfNew,
  setSyncSetting,
  type UpsertResult,
} from "@/lib/db/receipt-service";
import { parseCarrefourReceiptPdf } from "@/lib/parser/carrefour-pdf";
import { syncFromCarrefourSession } from "@/lib/sync/carrefour-client";

export async function GET(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const savedSession = await getSyncSetting("carrefour_session_cookie");
  const lastSyncAt = await getSyncSetting("last_sync_at");

  return NextResponse.json({
    hasSavedSession: Boolean(savedSession),
    lastSyncAt,
    syncToken: createBookmarkletToken(),
    authEnabled: isAuthEnabled(),
  });
}

export async function POST(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      cookieOrCurl?: string;
      harText?: string;
      saveSession?: boolean;
      clearSession?: boolean;
    };

    if (body.clearSession) {
      await setSyncSetting("carrefour_session_cookie", "");
      return NextResponse.json({ ok: true, cleared: true });
    }

    let sessionInput = body.cookieOrCurl?.trim() ?? "";
    if (!sessionInput) {
      sessionInput = (await getSyncSetting("carrefour_session_cookie")) ?? "";
    }

    if (body.saveSession && body.cookieOrCurl?.trim()) {
      await setSyncSetting(
        "carrefour_session_cookie",
        body.cookieOrCurl.trim()
      );
    }

    const db = await ensureDbInitialized();
    const existingRows = await db
      .select({ externalId: receipts.externalId })
      .from(receipts);
    const existingExternalIds = new Set(
      existingRows.map((r) => r.externalId)
    );

    const syncRes = await syncFromCarrefourSession({
      cookieOrCurl: sessionInput,
      existingExternalIds,
      extraHarText: body.harText,
    });

    const insertResults: UpsertResult[] = [];
    const parseErrors: string[] = [...syncRes.errors];

    for (const pdf of syncRes.downloadedPdfs) {
      try {
        const parsed = await parseCarrefourReceiptPdf(pdf.buffer, pdf.fileName);
        const inserted = await insertParsedReceiptIfNew(
          parsed,
          "carrefour_sync"
        );
        insertResults.push(inserted);
      } catch (err) {
        parseErrors.push(
          `${pdf.fileName}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const insertedCount = insertResults.filter((r) => r.inserted).length;
    const skippedCount = insertResults.filter((r) => r.skipped).length;

    if (insertedCount > 0) {
      await setSyncSetting("last_sync_at", new Date().toISOString());
    }

    return NextResponse.json({
      ok: syncRes.ok,
      blockedByBotProtection: syncRes.blockedByBotProtection,
      needsAuth: syncRes.needsAuth,
      statusCode: syncRes.statusCode,
      message: syncRes.message,
      discoveredCount: syncRes.discoveredTickets.length,
      discoveredTickets: syncRes.discoveredTickets.map((t) => ({
        externalId: t.externalId,
        ticketKey: t.ticketKey,
        date: t.date,
        storeCode: t.storeCode,
        alreadyInDb: existingExternalIds.has(t.externalId),
      })),
      insertedCount,
      skippedCount,
      results: insertResults,
      errors: parseErrors,
    });
  } catch (err) {
    console.error("POST /api/sync/carrefour error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors de la synchronisation Carrefour",
      },
      { status: 500 }
    );
  }
}
