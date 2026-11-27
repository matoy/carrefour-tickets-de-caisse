import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import {
  computeSuggestedMatches,
  createComparison,
  listComparisonsWithPrices,
  listDismissedSuggestionKeys,
  type CompareMode,
} from "@/lib/db/comparison-service";
import { listAggregatedProducts } from "@/lib/db/receipt-service";
import { getPeriodStartDate, parseTimePeriod } from "@/lib/period";

export async function GET(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const period = parseTimePeriod(
      request.nextUrl.searchParams.get("period"),
      "all"
    );
    const since = getPeriodStartDate(period);

    const [products, dismissedKeys] = await Promise.all([
      listAggregatedProducts(undefined, undefined, since),
      listDismissedSuggestionKeys(),
    ]);
    const comparisons = await listComparisonsWithPrices(
      products,
      since !== null
    );
    const suggestions = computeSuggestedMatches(
      products,
      comparisons,
      dismissedKeys
    );
    return NextResponse.json({ comparisons, suggestions });
  } catch (err) {
    console.error("GET /api/comparisons error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors du chargement des duels",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      name?: string;
      compareMode?: CompareMode;
      notes?: string | null;
      carrefourLabels?: string[];
      monoprixLabels?: string[];
    };

    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "Le nom du duel est requis" },
        { status: 400 }
      );
    }

    const carrefourLabels = body.carrefourLabels ?? [];
    const monoprixLabels = body.monoprixLabels ?? [];
    if (carrefourLabels.length === 0 && monoprixLabels.length === 0) {
      return NextResponse.json(
        { error: "Sélectionnez au moins un produit Carrefour ou Monoprix" },
        { status: 400 }
      );
    }

    const id = await createComparison({
      name,
      compareMode: body.compareMode,
      notes: body.notes,
      carrefourLabels,
      monoprixLabels,
    });

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    console.error("POST /api/comparisons error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors de la création du duel",
      },
      { status: 500 }
    );
  }
}
