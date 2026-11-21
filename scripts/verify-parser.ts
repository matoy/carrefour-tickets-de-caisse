import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { parseCarrefourReceiptPdf } from "../src/lib/parser/carrefour-pdf";
import {
  insertParsedReceiptIfNew,
  listAggregatedProducts,
  listReceipts,
} from "../src/lib/db/receipt-service";
import { closeDb, ensureDbInitialized } from "../src/lib/db";
import { createBookmarkletToken } from "../src/lib/auth";
import {
  extractDataFromHar,
  syncFromCarrefourSession,
} from "../src/lib/sync/carrefour-client";
import { GET as getReceiptsRoute } from "../src/app/api/receipts/route";
import { GET as getProductsRoute } from "../src/app/api/products/route";
import { POST as postProductNoteRoute } from "../src/app/api/products/note/route";
import { POST as postSyncCheckRoute } from "../src/app/api/sync/check/route";
import { GET as getSyncCarrefourRoute } from "../src/app/api/sync/carrefour/route";

async function main() {
  const root = process.cwd();

  console.log("1. Testing PDF parser on all 3 real Carrefour tickets...");

  // Ticket 1: 3-358-2001_ticket.pdf
  const pdf1 = fs.readFileSync(path.join(root, "3-358-2001_ticket.pdf"));
  const p1 = await parseCarrefourReceiptPdf(pdf1, "3-358-2001_ticket.pdf");
  assert.equal(p1.storeName, "CITY BOULOGNE_BILLANCOURT_BELLE_FEUILLE");
  assert.equal(p1.ticketKey, "3-358-2001");
  assert.equal(p1.items.length, 2);
  assert.equal(p1.totalPaid, 5.6);
  assert.equal(p1.loyaltyCredited, 0);
  assert.ok(!p1.rawText.includes("9135720000200557654"), "Loyalty card must be masked");
  console.log("  OK 3-358-2001_ticket.pdf:", p1.externalId, p1.totalPaid, "EUR,", p1.items.length, "items");

  // Ticket 2: 3-8993-1157_ticket.pdf
  const pdf2 = fs.readFileSync(path.join(root, "3-8993-1157_ticket.pdf"));
  const p2 = await parseCarrefourReceiptPdf(pdf2, "3-8993-1157_ticket.pdf");
  assert.equal(p2.storeName, "MARKET BOULOGNE-BILLANCOURT");
  assert.equal(p2.ticketKey, "3-8993-1157");
  assert.equal(p2.items.length, 22);
  assert.equal(p2.totalBeforeDiscount, 72.1);
  assert.equal(p2.totalImmediateDiscount, 1.48);
  assert.equal(p2.totalPaid, 70.62);
  assert.equal(p2.loyaltyCredited, 3.64);

  const patate1 = p2.items.find((i) => i.rawLabel === "PATATE DOUCE VRAC");
  assert.ok(patate1);
  assert.equal(patate1.weightKg, 0.886);
  assert.equal(patate1.pricePerKgOrL, 2.89);
  assert.equal(patate1.loyaltyDiscount, 0.26);

  const clem = p2.items.find((i) => i.rawLabel === "CLEMENTINE VRAC");
  assert.ok(clem);
  assert.equal(clem.weightKg, 0.519);
  assert.equal(clem.pricePerKgOrL, 4.99);

  const mango = p2.items.find((i) => i.rawLabel === "250ML DCH MANGO SP");
  assert.ok(mango);
  assert.equal(mango.immediateDiscount, 1.48);
  assert.equal(mango.netTotalPrice, 0.7);
  console.log("  OK 3-8993-1157_ticket.pdf:", p2.externalId, p2.totalPaid, "EUR,", p2.items.length, "items, loyalty", p2.loyaltyCredited);

  // Ticket 3: 7-925-1315_ticket.pdf
  const pdf3 = fs.readFileSync(path.join(root, "7-925-1315_ticket.pdf"));
  const p3 = await parseCarrefourReceiptPdf(pdf3, "7-925-1315_ticket.pdf");
  assert.equal(p3.storeName, "MARKET BOULOGNE-BILLANCOURT");
  assert.equal(p3.ticketKey, "7-925-1315");
  assert.equal(p3.items.length, 25);
  assert.equal(p3.totalBeforeDiscount, 97.34);
  assert.equal(p3.totalImmediateDiscount, 0.38);
  assert.equal(p3.totalPaid, 96.96);
  assert.equal(p3.loyaltyCredited, 5.22);

  const patate2 = p3.items.find((i) => i.rawLabel === "PATATE DOUCE VRAC");
  assert.ok(patate2);
  assert.equal(patate2.weightKg, 1.296);
  assert.equal(patate2.pricePerKgOrL, 1.59);

  const noix = p3.items.find((i) => i.rawLabel === "NOIX");
  assert.ok(noix);
  assert.equal(noix.weightKg, 0.566);
  assert.equal(noix.pricePerKgOrL, 18.4);

  const bavette = p3.items.find((i) => i.rawLabel === "BAVETTE DALOYAU");
  assert.ok(bavette);
  assert.equal(bavette.weightKg, 1.04);
  assert.equal(bavette.pricePerKgOrL, 15.9);

  const merguez = p3.items.find((i) => i.rawLabel === "MERGUEZ");
  assert.ok(merguez);
  assert.equal(merguez.weightKg, 0.148);
  assert.equal(merguez.pricePerKgOrL, 10.9);
  console.log("  OK 7-925-1315_ticket.pdf:", p3.externalId, p3.totalPaid, "EUR,", p3.items.length, "items, loyalty", p3.loyaltyCredited);

  console.log("2. Testing PostgreSQL insertion & deduplication...");
  await ensureDbInitialized();

  const r1a = await insertParsedReceiptIfNew(p1, "local_seed");
  const r2a = await insertParsedReceiptIfNew(p2, "local_seed");
  const r3a = await insertParsedReceiptIfNew(p3, "local_seed");
  console.log("  First pass:", {
    r1: r1a.inserted ? "inserted" : "skipped",
    r2: r2a.inserted ? "inserted" : "skipped",
    r3: r3a.inserted ? "inserted" : "skipped",
  });

  // Second pass must skip all 3!
  const r1b = await insertParsedReceiptIfNew(p1, "local_seed");
  const r2b = await insertParsedReceiptIfNew(p2, "local_seed");
  const r3b = await insertParsedReceiptIfNew(p3, "local_seed");
  assert.equal(r1b.inserted, false);
  assert.equal(r2b.inserted, false);
  assert.equal(r3b.inserted, false);
  assert.equal(r1b.skipped, true);
  assert.equal(r2b.skipped, true);
  assert.equal(r3b.skipped, true);
  console.log("  OK Deduplication verified (0 inserted, 3 skipped on 2nd pass)");

  const list = await listReceipts(true);
  assert.ok(list.receipts.length >= 3);
  console.log("  OK Receipts in DB:", list.receipts.length, "Total spent:", list.stats.totalSpent);

  const patates = await listAggregatedProducts("patate douce");
  assert.equal(patates.length, 1);
  assert.equal(patates[0].history.length, 2);
  console.log("  OK Search 'patate douce' price trend:", patates[0].priceTrendPct, "%");

  const oranges = await listAggregatedProducts("orange");
  assert.ok(oranges.length >= 1, "Abbreviation expansion ORAN -> ORANGE must match");
  console.log("  OK Abbreviation search 'orange' matched:", oranges[0].rawLabel);

  console.log("3. Testing Next.js API route handlers...");
  const recRes = await getReceiptsRoute(
    new NextRequest("http://localhost:3000/api/receipts?includeItems=true")
  );
  assert.equal(recRes.status, 200);
  const recJson = (await recRes.json()) as {
    receipts: unknown[];
    stats: { totalReceipts: number; totalSpent: number; totalSaved: number };
  };
  assert.equal(recJson.receipts.length, 3);
  assert.equal(recJson.stats.totalSpent, 173.18);

  const prodRes = await getProductsRoute(
    new NextRequest("http://localhost:3000/api/products?q=patate+douce")
  );
  assert.equal(prodRes.status, 200);
  const prodJson = (await prodRes.json()) as {
    products: Array<{ rawLabel: string; lastPricePerKgOrL: number }>;
  };
  assert.equal(prodJson.products.length, 1);
  assert.equal(prodJson.products[0].lastPricePerKgOrL, 1.59);

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
  const noteClearRes = await postProductNoteRoute(
    new NextRequest("http://localhost:3000/api/products/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawLabel: "1L LAIT S/LACT ML LA",
        monoprixPrice: null,
      }),
    })
  );
  assert.equal(noteClearRes.status, 200);

  const syncCheckRes = await postSyncCheckRoute(
    new NextRequest("http://localhost:3000/api/sync/check", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Origin: "https://www.carrefour.fr",
      },
      body: JSON.stringify({
        syncToken: createBookmarkletToken(),
        externalIds: ["20261101-7837-3-8993-1157", "20990101-0000-1-1-0000"],
      }),
    })
  );
  assert.equal(syncCheckRes.status, 200);
  assert.equal(
    syncCheckRes.headers.get("Access-Control-Allow-Origin"),
    "https://www.carrefour.fr"
  );
  const syncCheckJson = (await syncCheckRes.json()) as {
    missingExternalIds: string[];
  };
  assert.deepEqual(syncCheckJson.missingExternalIds, [
    "20990101-0000-1-1-0000",
  ]);

  const syncGetRes = await getSyncCarrefourRoute(
    new NextRequest("http://localhost:3000/api/sync/carrefour")
  );
  assert.equal(syncGetRes.status, 200);
  const syncGetJson = (await syncGetRes.json()) as { syncToken: string };
  assert.ok(syncGetJson.syncToken.startsWith("bookmarklet-sync."));
  console.log("  OK All 5 API route handlers returned HTTP 200 with expected JSON!");

  console.log("4. Testing HAR extraction (cookies, embedded PDFs, and cookie-less diagnostic)...");
  const cookieLessHar = JSON.stringify({
    log: {
      entries: [
        {
          request: {
            url: "https://dcinfos-cache.abtasty.com/test",
            headers: [],
            cookies: [],
          },
          response: { content: { mimeType: "application/json", text: "[]" } },
        },
      ],
    },
  });
  const harDiagRes = await syncFromCarrefourSession({
    cookieOrCurl: "",
    existingExternalIds: new Set(),
    extraHarText: cookieLessHar,
  });
  assert.equal(harDiagRes.ok, false);
  assert.equal(harDiagRes.needsAuth, true);
  assert.ok(
    harDiagRes.message.includes("1 requête(s) (dont 0 vers carrefour.fr)"),
    "Should report detailed HAR diagnostic"
  );

  const richHar = JSON.stringify({
    log: {
      entries: [
        {
          request: {
            url: "https://www.carrefour.fr/mon-compte/mes-achats/en-magasin/3021080622705/20261113/9422/3-358-2001/pdf",
            headers: [{ name: "Cookie", value: "session=abc123; token=xyz" }],
          },
          response: {
            content: {
              mimeType: "application/pdf",
              encoding: "base64",
              text: pdf1.toString("base64"),
            },
          },
        },
      ],
    },
  });
  const harExtracted = extractDataFromHar(richHar);
  assert.equal(harExtracted.carrefourEntryCount, 1);
  assert.equal(harExtracted.cookieHeader, "session=abc123; token=xyz");
  assert.equal(harExtracted.embeddedPdfs.length, 1);
  assert.equal(harExtracted.embeddedPdfs[0].ticketKey, "3-358-2001");

  const harPdfOnly = JSON.stringify({
    log: {
      entries: [
        {
          request: {
            url: "https://www.carrefour.fr/mon-compte/mes-achats/en-magasin/3021080622705/20261113/9422/3-358-2001/pdf",
            headers: [],
          },
          response: {
            content: {
              mimeType: "application/pdf",
              encoding: "base64",
              text: pdf1.toString("base64"),
            },
          },
        },
      ],
    },
  });
  const harPdfRes = await syncFromCarrefourSession({
    cookieOrCurl: "",
    existingExternalIds: new Set(),
    extraHarText: harPdfOnly,
  });
  assert.equal(harPdfRes.ok, true);
  assert.equal(harPdfRes.downloadedPdfs.length, 1);
  console.log("  OK HAR extraction & diagnostics verified!");

  console.log("ALL PARSER, DB & API ROUTE CHECKS PASSED!");
  await closeDb();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Verification failed:", err);
  await closeDb().catch(() => {});
  process.exit(1);
});
