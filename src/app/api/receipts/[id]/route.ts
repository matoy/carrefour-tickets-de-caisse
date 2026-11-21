import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isApiRequestAuthenticated } from "@/lib/auth";
import { ensureDbInitialized } from "@/lib/db";
import { receipts, receiptItems } from "@/lib/db/schema";

export async function GET(
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

  const db = await ensureDbInitialized();
  const rows = await db
    .select()
    .from(receipts)
    .where(eq(receipts.id, numericId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 });
  }

  const r = rows[0];
  const items = await db
    .select()
    .from(receiptItems)
    .where(eq(receiptItems.receiptId, numericId));

  items.sort((a, b) => a.lineIndex - b.lineIndex);

  return NextResponse.json({
    receipt: {
      id: r.id,
      retailer: r.retailer === "monoprix" ? "monoprix" : "carrefour",
      externalId: r.externalId,
      ticketKey: r.ticketKey,
      storeName: r.storeName,
      storeCode: r.storeCode,
      purchaseDate: r.purchaseDate.toISOString(),
      totalBeforeDiscount: Number(r.totalBeforeDiscount),
      totalImmediateDiscount: Number(r.totalImmediateDiscount),
      globalDiscount: Number(r.globalDiscount),
      extraFees: Number(r.extraFees),
      totalPaid: Number(r.totalPaid),
      loyaltyCredited: Number(r.loyaltyCredited),
      paymentMethod: r.paymentMethod,
      barcode: r.barcode,
      source: r.source,
      fileName: r.fileName,
      rawText: r.rawText,
      items: items.map((it) => ({
        id: it.id,
        lineIndex: it.lineIndex,
        rawLabel: it.rawLabel,
        normalizedLabel: it.normalizedLabel,
        vatRate: it.vatRate !== null ? Number(it.vatRate) : null,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        totalPrice: Number(it.totalPrice),
        immediateDiscount: Number(it.immediateDiscount),
        loyaltyDiscount: Number(it.loyaltyDiscount),
        netTotalPrice: Number(it.netTotalPrice),
        netUnitPrice: Number(it.netUnitPrice),
        weightKg: it.weightKg !== null ? Number(it.weightKg) : null,
        volumeL: it.volumeL !== null ? Number(it.volumeL) : null,
        pricePerKgOrL:
          it.pricePerKgOrL !== null ? Number(it.pricePerKgOrL) : null,
        netPricePerKgOrL:
          it.netPricePerKgOrL !== null ? Number(it.netPricePerKgOrL) : null,
        unitType: it.unitType,
      })),
    },
  });
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

  const db = await ensureDbInitialized();
  const deleted = await db
    .delete(receipts)
    .where(eq(receipts.id, numericId))
    .returning({ id: receipts.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: numericId });
}
