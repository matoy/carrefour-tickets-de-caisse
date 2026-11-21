import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { parseReceiptPdf } from "../src/lib/parser";
import { parseMonoprixFromDocument } from "../src/lib/parser/monoprix-pdf";
import type {
  ExtractedPdfDocument,
  PdfTextItem,
} from "../src/lib/parser/pdf-text";
import {
  insertParsedReceiptIfNew,
  listAggregatedProducts,
  listReceipts,
} from "../src/lib/db/receipt-service";
import {
  computeSuggestedMatches,
  listComparisonsWithPrices,
} from "../src/lib/db/comparison-service";
import { closeDb, ensureDbInitialized } from "../src/lib/db";
import { GET as getReceiptsRoute } from "../src/app/api/receipts/route";
import { DELETE as deleteReceiptRoute } from "../src/app/api/receipts/[id]/route";
import { GET as getProductsRoute } from "../src/app/api/products/route";
import { POST as postProductNoteRoute } from "../src/app/api/products/note/route";
import {
  GET as getComparisonsRoute,
  POST as postComparisonRoute,
} from "../src/app/api/comparisons/route";
import {
  PATCH as patchComparisonRoute,
  DELETE as deleteComparisonRoute,
} from "../src/app/api/comparisons/[id]/route";

function makeMonoprixRow(
  y: number,
  labelLines: string[],
  ht: string,
  vat: string,
  ttc: string,
  remise: string,
  qty: number,
  total: string
): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  labelLines.forEach((line, idx) => {
    items.push({ str: line, x: 70, y: y + (labelLines.length - 1 - idx) * 10 - (labelLines.length > 1 ? 5 : 0), width: 120 });
  });
  items.push(
    { str: `${ht} €`, x: 230, y, width: 30 },
    { str: vat, x: 270, y: y + 2, width: 18 },
    { str: "%", x: 272, y: y - 7, width: 10 },
    { str: `${ttc} €`, x: 300, y, width: 30 },
    { str: `${remise} €`, x: 345, y, width: 30 },
    { str: String(qty), x: 390, y, width: 10 },
    { str: `${total} €`, x: 420, y, width: 35 }
  );
  return items;
}

function buildMonoprixInvoiceFixture(): ExtractedPdfDocument {
  const page1Items: PdfTextItem[] = [
    { str: "MONOPRIX.fr", x: 70, y: 780, width: 100 },
    { str: "Nom du client : Carol texier", x: 70, y: 720, width: 140 },
    { str: "N° de facture : 1156958913842", x: 70, y: 705, width: 140 },
    { str: "Votre e-mail : carol.texier@gmail.com", x: 70, y: 690, width: 160 },
    { str: "Date de la commande : samedi, 14/11/2026 11:47", x: 70, y: 675, width: 200 },
    { str: "87 Rue Gallieni, 92100 Boulogne-Billancourt, France", x: 310, y: 690, width: 180 },
    { str: "Libellé produit", x: 70, y: 600, width: 80 },
    ...makeMonoprixRow(570, ["Boule d'Or Mimolette Demi-Vieille Affiné 7", "Mois 250g"], "5,01", "5,5", "5,29", "5,29", 1, "5,29"),
    ...makeMonoprixRow(540, ["Connétable Filets de Maquereaux au naturel", "Label Rouge 106g"], "4,35", "5,5", "4,59", "4,59", 1, "4,59"),
    ...makeMonoprixRow(510, ["Courgette 1kg"], "2,36", "5,5", "2,49", "2,49", 1, "2,49"),
    ...makeMonoprixRow(485, ["Cœur de Sucrine x3"], "1,70", "5,5", "1,79", "1,79", 2, "3,58"),
    ...makeMonoprixRow(455, ["Danone Cottage Cheese Fromage Salé", "400g"], "4,03", "5,5", "4,25", "4,25", 1, "4,25"),
    ...makeMonoprixRow(430, ["Florelli Gressins Artisanal multigraines 250g"], "2,74", "5,5", "2,89", "2,89", 1, "2,89"),
    ...makeMonoprixRow(405, ["Gillette Fusion 5 Recharges Lames x4"], "14,92", "20", "17,90", "13,43", 2, "26,85"),
    ...makeMonoprixRow(380, ["La Boulangère Pains au lait Bio x8 280g"], "2,23", "5,5", "2,35", "2,35", 1, "2,35"),
    ...makeMonoprixRow(350, ["La Nouvelle Agriculture Cuisse De Poulet", "360g"], "3,55", "5,5", "3,75", "3,75", 1, "3,75"),
    ...makeMonoprixRow(325, ["Lu Cracotte Biscottes au Froment 250g"], "1,75", "5,5", "1,85", "1,23", 3, "3,70"),
    ...makeMonoprixRow(300, ["Monoprix Bio Comté au lait cru 200g"], "4,88", "5,5", "5,15", "5,15", 1, "5,15"),
    ...makeMonoprixRow(270, ["Monoprix Bio Couscous Grain Moyen Prêt", "En 5Mn 500g"], "2,23", "5,5", "2,35", "2,35", 1, "2,35"),
    ...makeMonoprixRow(245, ["Monoprix Bio Pavés de saumon 240g"], "9,09", "5,5", "9,59", "9,59", 1, "9,59"),
    ...makeMonoprixRow(220, ["Monoprix Bio Riz Basmati 500g"], "2,32", "5,5", "2,45", "2,45", 1, "2,45"),
    ...makeMonoprixRow(195, ["Monoprix Bio Steak haché 2x125g"], "6,63", "5,5", "6,99", "6,99", 1, "6,99"),
    ...makeMonoprixRow(165, ["Monoprix Bio Yaourt aromatisé vanille", "4x125g"], "1,37", "5,5", "1,45", "1,45", 1, "1,45"),
    ...makeMonoprixRow(140, ["Monoprix Bio Œufs x6"], "2,45", "5,5", "2,59", "2,59", 1, "2,59"),
  ];

  const page2Items: PdfTextItem[] = [
    ...makeMonoprixRow(740, ["Monoprix Crottin de chèvre 2x60g"], "2,64", "5,5", "2,79", "2,79", 1, "2,79"),
    ...makeMonoprixRow(715, ["Monoprix Filets Poulet 2x120g"], "5,85", "5,5", "6,17", "6,17", 1, "6,17"),
    ...makeMonoprixRow(690, ["Monoprix Liégeois au chocolat x4 pots, 400g"], "1,32", "5,5", "1,39", "1,39", 1, "1,39"),
    ...makeMonoprixRow(660, ["Monoprix Mimolette en tranche le paquet", "200g"], "2,04", "5,5", "2,15", "2,15", 1, "2,15"),
    ...makeMonoprixRow(630, ["Monoprix Papier Toilette double épaisseur", "x12"], "2,82", "20", "3,39", "3,39", 1, "3,39"),
    ...makeMonoprixRow(605, ["Monoprix Ricotta 250g"], "1,47", "5,5", "1,55", "1,55", 1, "1,55"),
    ...makeMonoprixRow(575, ["Monoprix Sardines à l'Huile d'Olive Vierge", "Extra 87g"], "1,89", "5,5", "1,99", "1,99", 1, "1,99"),
    ...makeMonoprixRow(545, ["Monoprix Sardines à l'Huile d'Olive Vierge", "Extra et Au Citron 87g"], "1,89", "5,5", "1,99", "1,99", 1, "1,99"),
    ...makeMonoprixRow(520, ["Monoprix Yaourt à la grecque 4x150g"], "1,79", "5,5", "1,89", "1,89", 2, "3,78"),
    ...makeMonoprixRow(490, ["Oral-B Essential Fil Dentaire Ciré Menthe", "50m"], "3,04", "20", "3,65", "3,65", 1, "3,65"),
    ...makeMonoprixRow(460, ["Petit Navire Filets de Maquereaux sans", "peau huile olive 145g"], "2,99", "5,5", "3,15", "3,15", 1, "3,15"),
    ...makeMonoprixRow(435, ["Pomme de Terre Vapeur et Salade Bio 1,5kg"], "4,26", "5,5", "4,49", "4,49", 1, "4,49"),
    ...makeMonoprixRow(405, ["Quies Protection Auditive, Mousse Confort", "Fluo. x8"], "6,74", "20", "8,09", "8,09", 1, "8,09"),
    ...makeMonoprixRow(375, ["St Moret Le Goût Primeur Format Familial", "400g"], "5,11", "5,5", "5,39", "5,39", 1, "5,39"),
    ...makeMonoprixRow(345, ["Tendriade Haché De Veau Façon Bouchère", "2x100g"], "4,64", "5,5", "4,89", "4,89", 1, "4,89"),
    ...makeMonoprixRow(315, ["Volvic Eau Minérale Naturelle Volcanique", "6x1,5L"], "3,88", "5,5", "4,09", "3,27", 2, "6,54"),
    ...makeMonoprixRow(285, ["Yoplait Panier De Yoplait Morceaux Fruits", "Rouges 8x125g"], "3,12", "5,5", "3,29", "3,29", 1, "3,29"),
    { str: "Nombre total d'articles", x: 300, y: 240, width: 100 },
  ];

  const page1Lines = [
    "MONOPRIX.fr Courses",
    "Nom du client : Carol texier",
    "N° de facture : 1156958913842",
    "Votre e-mail : carol.texier@gmail.com",
    "Date de la commande : samedi, 14/11/2026 11:47",
    "Date de la livraison : dimanche, 15/11/2026",
    "87 Rue Gallieni, 92100 Boulogne-Billancourt, France",
    "Utilisation cagnotte : 0,00 €",
    "Cagnotté : 0,00 €",
  ];

  const page2Lines = [
    "Nombre total d'articles 40",
    "Nombre de produits 34",
    "Total des marchandises HT 155,82 €",
    "Total des marchandises 167,44 €",
    "TTC",
    "Total remises marchandises 12,44 €",
    "Frais de préparation 2,00 €",
    "Frais de livraison 0,00 €",
  ];

  const page3Lines = [
    "Consigne de sacs de courses 0,80 €",
    "Retour",
    "6 sacs 0,60 €",
    "10% remise M+ 15,50 €",
    "Utilisation cagnotte 0,00 €",
    "Total de la commande 141,70 €",
  ];

  return {
    pages: [
      { pageNumber: 1, items: page1Items, lines: page1Lines },
      { pageNumber: 2, items: page2Items, lines: page2Lines },
      { pageNumber: 3, items: [], lines: page3Lines },
    ],
    allLines: [...page1Lines, ...page2Lines, ...page3Lines],
  };
}

async function main() {
  const root = process.cwd();

  console.log("1. Testing Carrefour PDF parser via unified parseReceiptPdf...");

  const pdf1 = fs.readFileSync(path.join(root, "3-358-2001_ticket.pdf"));
  const p1 = await parseReceiptPdf(pdf1, "3-358-2001_ticket.pdf");
  assert.equal(p1.retailer, "carrefour");
  assert.equal(p1.storeName, "CITY BOULOGNE_BILLANCOURT_BELLE_FEUILLE");
  assert.equal(p1.ticketKey, "3-358-2001");
  assert.equal(p1.items.length, 2);
  assert.equal(p1.totalPaid, 5.6);
  assert.equal(p1.loyaltyCredited, 0);
  assert.ok(!p1.rawText.includes("9135720000200557654"), "Loyalty card must be masked");
  console.log("  OK 3-358-2001_ticket.pdf:", p1.externalId, p1.totalPaid, "EUR");

  const pdf2 = fs.readFileSync(path.join(root, "3-8993-1157_ticket.pdf"));
  const p2 = await parseReceiptPdf(pdf2, "3-8993-1157_ticket.pdf");
  assert.equal(p2.retailer, "carrefour");
  assert.equal(p2.storeName, "MARKET BOULOGNE-BILLANCOURT");
  assert.equal(p2.ticketKey, "3-8993-1157");
  assert.equal(p2.items.length, 22);
  assert.equal(p2.totalBeforeDiscount, 72.1);
  assert.equal(p2.totalImmediateDiscount, 1.48);
  assert.equal(p2.totalPaid, 70.62);
  assert.equal(p2.loyaltyCredited, 3.64);
  console.log("  OK 3-8993-1157_ticket.pdf:", p2.externalId, p2.totalPaid, "EUR");

  const pdf3 = fs.readFileSync(path.join(root, "7-925-1315_ticket.pdf"));
  const p3 = await parseReceiptPdf(pdf3, "7-925-1315_ticket.pdf");
  assert.equal(p3.retailer, "carrefour");
  assert.equal(p3.storeName, "MARKET BOULOGNE-BILLANCOURT");
  assert.equal(p3.ticketKey, "7-925-1315");
  assert.equal(p3.items.length, 25);
  assert.equal(p3.totalBeforeDiscount, 97.34);
  assert.equal(p3.totalImmediateDiscount, 0.38);
  assert.equal(p3.totalPaid, 96.96);
  assert.equal(p3.loyaltyCredited, 5.22);
  console.log("  OK 7-925-1315_ticket.pdf:", p3.externalId, p3.totalPaid, "EUR");

  console.log("2. Testing Monoprix Courses PDF parser (3-page invoice + -10% M+ proration + PII mask)...");
  const monoprixDoc = buildMonoprixInvoiceFixture();
  const mono = parseMonoprixFromDocument(monoprixDoc, "monoprix_test.pdf");
  assert.equal(mono.retailer, "monoprix");
  assert.equal(mono.externalId, "monoprix-1156958913842");
  assert.equal(mono.ticketKey, "1156958913842");
  assert.equal(mono.items.length, 34);
  assert.equal(mono.totalBeforeDiscount, 167.44);
  assert.equal(mono.totalImmediateDiscount, 12.44);
  assert.equal(mono.globalDiscount, 15.5);
  assert.equal(mono.extraFees, 2.2);
  assert.equal(mono.totalPaid, 141.7);

  const loyaltySum = Math.round(mono.items.reduce((s, i) => s + i.loyaltyDiscount, 0) * 100) / 100;
  assert.equal(loyaltySum, 15.5);

  const sucrineMono = mono.items.find((i) => i.rawLabel === "Cœur de Sucrine x3");
  assert.ok(sucrineMono);
  assert.equal(sucrineMono.quantity, 2);
  assert.equal(sucrineMono.unitPrice, 1.79);
  assert.equal(sucrineMono.netUnitPrice, 1.61);

  const liegeois = mono.items.find(
    (i) => i.rawLabel === "Monoprix Liégeois au chocolat x4 pots, 400g"
  );
  assert.ok(liegeois);
  assert.equal(liegeois.weightKg, 0.4);

  const volvic = mono.items.find(
    (i) => i.rawLabel === "Volvic Eau Minérale Naturelle Volcanique 6x1,5L"
  );
  assert.ok(volvic);
  assert.equal(volvic.volumeL, 18);
  assert.equal(volvic.immediateDiscount, 1.64);

  assert.ok(!mono.rawText.includes("Carol texier"), "Customer name must be masked");
  assert.ok(!mono.rawText.includes("carol.texier@gmail.com"), "Email must be masked");
  assert.ok(!mono.rawText.includes("87 Rue Gallieni"), "Delivery address must be masked");
  console.log("  OK Monoprix invoice parsed: 34 items, 141.70 EUR, M+ -15.50 EUR, fees +2.20 EUR");

  console.log("3. Testing PostgreSQL insertion, deduplication, auto-suggestions & Duel API...");
  await ensureDbInitialized();

  await insertParsedReceiptIfNew(p1, "local_seed");
  await insertParsedReceiptIfNew(p2, "local_seed");
  await insertParsedReceiptIfNew(p3, "local_seed");

  // Second pass deduplication check
  const dup = await insertParsedReceiptIfNew(p1, "local_seed");
  assert.equal(dup.inserted, false);
  assert.equal(dup.skipped, true);

  // Insert synthetic Monoprix invoice to test cross-retailer comparison & API routes
  const monoInsert = await insertParsedReceiptIfNew(mono, "pdf_upload");
  assert.ok(monoInsert.receiptId !== null);

  try {
    const allProducts = await listAggregatedProducts();
    const existingComps = await listComparisonsWithPrices(allProducts);
    const suggestions = computeSuggestedMatches(allProducts, existingComps);
    const sucrineSuggestion = suggestions.find(
      (s) =>
        s.carrefourProduct.rawLabel === "SUCRINE BARQUETTE" &&
        s.monoprixProduct.rawLabel === "Cœur de Sucrine x3"
    );
    assert.ok(sucrineSuggestion, "Auto-suggestion should match SUCRINE BARQUETTE <-> Cœur de Sucrine x3");

    // Test Duel CRUD API routes
    const createRes = await postComparisonRoute(
      new NextRequest("http://localhost:3000/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Sucrine (test)",
          compareMode: "unit",
          carrefourLabels: ["SUCRINE BARQUETTE"],
          monoprixLabels: ["Cœur de Sucrine x3"],
        }),
      })
    );
    assert.equal(createRes.status, 201);
    const createdJson = (await createRes.json()) as { id: number };

    const getCompRes = await getComparisonsRoute(
      new NextRequest("http://localhost:3000/api/comparisons")
    );
    assert.equal(getCompRes.status, 200);
    const getCompJson = (await getCompRes.json()) as {
      comparisons: Array<{
        id: number;
        net: { winner: string; carrefourPrice: number; monoprixPrice: number };
      }>;
    };
    const createdDuel = getCompJson.comparisons.find((c) => c.id === createdJson.id);
    assert.ok(createdDuel);
    assert.equal(createdDuel.net.winner, "monoprix");
    assert.equal(createdDuel.net.carrefourPrice, 1.99);
    assert.equal(createdDuel.net.monoprixPrice, 1.61);

    const patchRes = await patchComparisonRoute(
      new NextRequest(`http://localhost:3000/api/comparisons/${createdJson.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Sucrine modifiée" }),
      }),
      { params: Promise.resolve({ id: String(createdJson.id) }) }
    );
    assert.equal(patchRes.status, 200);

    const delCompRes = await deleteComparisonRoute(
      new NextRequest(`http://localhost:3000/api/comparisons/${createdJson.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: String(createdJson.id) }) }
    );
    assert.equal(delCompRes.status, 200);
  } finally {
    // Remove synthetic Monoprix test receipt so local dev DB stays clean
    if (monoInsert.inserted && monoInsert.receiptId !== null) {
      await deleteReceiptRoute(
        new NextRequest(`http://localhost:3000/api/receipts/${monoInsert.receiptId}`, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: String(monoInsert.receiptId) }) }
      );
    }
  }

  // Test existing receipts & products API routes
  const list = await listReceipts(true);
  assert.equal(list.receipts.length, 3);

  const recRes = await getReceiptsRoute(
    new NextRequest("http://localhost:3000/api/receipts?includeItems=true")
  );
  assert.equal(recRes.status, 200);

  const prodRes = await getProductsRoute(
    new NextRequest("http://localhost:3000/api/products?q=orange&retailer=carrefour")
  );
  assert.equal(prodRes.status, 200);
  const prodJson = (await prodRes.json()) as {
    products: Array<{ rawLabel: string }>;
  };
  assert.ok(prodJson.products.length >= 1);

  const noteSetRes = await postProductNoteRoute(
    new NextRequest("http://localhost:3000/api/products/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawLabel: "1L LAIT S/LACT ML LA",
        monoprixPrice: 3.1,
      }),
    })
  );
  assert.equal(noteSetRes.status, 200);
  await postProductNoteRoute(
    new NextRequest("http://localhost:3000/api/products/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawLabel: "1L LAIT S/LACT ML LA",
        monoprixPrice: null,
      }),
    })
  );

  console.log("ALL CARREFOUR + MONOPRIX PARSER, DB & DUEL API CHECKS PASSED!");
  await closeDb();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Verification failed:", err);
  await closeDb().catch(() => {});
  process.exit(1);
});
