import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import {
  deleteComparison,
  updateComparison,
  type CompareMode,
} from "@/lib/db/comparison-service";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await context.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "ID invalide" }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      name?: string;
      compareMode?: CompareMode;
      notes?: string | null;
      carrefourLabels?: string[];
      monoprixLabels?: string[];
    };

    const updated = await updateComparison(numericId, body);
    if (!updated) {
      return NextResponse.json({ error: "Duel introuvable" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id: numericId });
  } catch (err) {
    console.error("PATCH /api/comparisons/[id] error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors de la mise à jour du duel",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await context.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "ID invalide" }, { status: 400 });
  }

  const deleted = await deleteComparison(numericId);
  if (!deleted) {
    return NextResponse.json({ error: "Duel introuvable" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: numericId });
}
