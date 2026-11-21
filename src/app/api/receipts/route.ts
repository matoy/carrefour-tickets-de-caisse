import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import { listReceipts } from "@/lib/db/receipt-service";

export async function GET(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const includeItems =
      request.nextUrl.searchParams.get("includeItems") === "true";
    const data = await listReceipts(includeItems);
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/receipts error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors de la récupération des tickets",
      },
      { status: 500 }
    );
  }
}
