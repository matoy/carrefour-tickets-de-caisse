import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import { ensureDbInitialized } from "@/lib/db";
import { receipts } from "@/lib/db/schema";

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
    const body = (await request.json()) as {
      externalIds?: string[];
      ticketKeys?: string[];
    };

    const db = await ensureDbInitialized();
    const existingRows = await db
      .select({
        externalId: receipts.externalId,
        ticketKey: receipts.ticketKey,
      })
      .from(receipts);

    const existingExternalSet = new Set(existingRows.map((r) => r.externalId));
    const existingKeySet = new Set(existingRows.map((r) => r.ticketKey));

    const missingExternalIds = (body.externalIds ?? []).filter(
      (id) => !existingExternalSet.has(id)
    );
    const missingTicketKeys = (body.ticketKeys ?? []).filter(
      (k) => !existingKeySet.has(k)
    );

    return NextResponse.json(
      {
        existingCount: existingRows.length,
        missingExternalIds,
        missingTicketKeys,
      },
      { headers: cors }
    );
  } catch (err) {
    console.error("POST /api/sync/check error:", err);
    return NextResponse.json(
      { error: "Erreur lors de la vérification des tickets" },
      { status: 500, headers: cors }
    );
  }
}
