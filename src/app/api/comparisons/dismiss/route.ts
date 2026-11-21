import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import { dismissSuggestion } from "@/lib/db/comparison-service";

export async function POST(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      carrefourLabel?: string;
      monoprixLabel?: string;
    };

    const carrefourLabel = body.carrefourLabel?.trim();
    const monoprixLabel = body.monoprixLabel?.trim();
    if (!carrefourLabel || !monoprixLabel) {
      return NextResponse.json(
        { error: "carrefourLabel et monoprixLabel sont requis" },
        { status: 400 }
      );
    }

    await dismissSuggestion(carrefourLabel, monoprixLabel);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/comparisons/dismiss error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors du refus de la suggestion",
      },
      { status: 500 }
    );
  }
}
