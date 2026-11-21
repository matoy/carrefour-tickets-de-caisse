import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import { syncLocalWorkspacePdfs } from "@/lib/db/receipt-service";

export async function POST(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const result = await syncLocalWorkspacePdfs();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("POST /api/receipts/sync-local error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors de la synchronisation du dossier local",
      },
      { status: 500 }
    );
  }
}
