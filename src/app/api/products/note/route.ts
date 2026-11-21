import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import { ensureDbInitialized } from "@/lib/db";
import { productNotes } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      rawLabel?: string;
      customName?: string | null;
      monoprixPrice?: number | string | null;
      monoprixUnit?: string | null;
      notes?: string | null;
    };

    const rawLabel = body.rawLabel?.trim();
    if (!rawLabel) {
      return NextResponse.json(
        { error: "rawLabel est requis" },
        { status: 400 }
      );
    }

    const parsedMonoprixPrice =
      body.monoprixPrice === null ||
      body.monoprixPrice === undefined ||
      body.monoprixPrice === ""
        ? null
        : Number(String(body.monoprixPrice).replace(",", "."));

    if (
      parsedMonoprixPrice !== null &&
      (!Number.isFinite(parsedMonoprixPrice) || parsedMonoprixPrice < 0)
    ) {
      return NextResponse.json(
        { error: "Prix Monoprix invalide" },
        { status: 400 }
      );
    }

    const db = await ensureDbInitialized();
    const customName = body.customName?.trim() || null;
    const monoprixUnit = body.monoprixUnit?.trim() || null;
    const notes = body.notes?.trim() || null;
    const monoprixPriceStr =
      parsedMonoprixPrice !== null ? parsedMonoprixPrice.toFixed(2) : null;

    await db
      .insert(productNotes)
      .values({
        rawLabel,
        customName,
        monoprixPrice: monoprixPriceStr,
        monoprixUnit,
        notes,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: productNotes.rawLabel,
        set: {
          customName,
          monoprixPrice: monoprixPriceStr,
          monoprixUnit,
          notes,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      ok: true,
      rawLabel,
      customName,
      monoprixPrice: parsedMonoprixPrice,
      monoprixUnit,
      notes,
    });
  } catch (err) {
    console.error("POST /api/products/note error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors de l'enregistrement de la comparaison",
      },
      { status: 500 }
    );
  }
}
