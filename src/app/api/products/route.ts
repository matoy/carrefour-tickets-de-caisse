import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import { listAggregatedProducts } from "@/lib/db/receipt-service";
import type { Retailer } from "@/lib/parser";
import { getPeriodStartDate, parseTimePeriod } from "@/lib/period";

export async function GET(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const rawRetailer = request.nextUrl.searchParams.get("retailer");
    const retailerFilter: Retailer | "all" | undefined =
      rawRetailer === "carrefour" || rawRetailer === "monoprix"
        ? rawRetailer
        : undefined;
    const period = parseTimePeriod(
      request.nextUrl.searchParams.get("period"),
      "all"
    );
    const since = getPeriodStartDate(period);

    const products = await listAggregatedProducts(q, retailerFilter, since);
    return NextResponse.json({ products });
  } catch (err) {
    console.error("GET /api/products error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors de la recherche produits",
      },
      { status: 500 }
    );
  }
}
