import { redirect } from "next/navigation";
import { isAuthEnabled, isRequestAuthenticated } from "@/lib/auth";
import { isUsingRemotePostgres } from "@/lib/db";
import {
  listAggregatedProducts,
  listReceipts,
} from "@/lib/db/receipt-service";
import {
  computeSuggestedMatches,
  listComparisonsWithPrices,
} from "@/lib/db/comparison-service";
import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authenticated = await isRequestAuthenticated();
  if (!authenticated) {
    redirect("/login");
  }

  const [{ receipts, stats }, products] = await Promise.all([
    listReceipts(true),
    listAggregatedProducts(),
  ]);
  const comparisons = await listComparisonsWithPrices(products);
  const suggestions = computeSuggestedMatches(products, comparisons);

  return (
    <DashboardClient
      initialReceipts={receipts}
      initialStats={stats}
      initialProducts={products}
      initialComparisons={comparisons}
      initialSuggestions={suggestions}
      authEnabled={isAuthEnabled()}
      isRemotePostgres={isUsingRemotePostgres()}
    />
  );
}
