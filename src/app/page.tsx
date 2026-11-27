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
  listDismissedSuggestionKeys,
} from "@/lib/db/comparison-service";
import { DashboardClient } from "@/components/DashboardClient";
import { DEFAULT_TIME_PERIOD, getPeriodStartDate } from "@/lib/period";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authenticated = await isRequestAuthenticated();
  if (!authenticated) {
    redirect("/login");
  }

  const since = getPeriodStartDate(DEFAULT_TIME_PERIOD);

  const [{ receipts, stats }, products, dismissedKeys] = await Promise.all([
    listReceipts(true, since),
    listAggregatedProducts(undefined, undefined, since),
    listDismissedSuggestionKeys(),
  ]);
  const comparisons = await listComparisonsWithPrices(products, since !== null);
  const suggestions = computeSuggestedMatches(
    products,
    comparisons,
    dismissedKeys
  );

  return (
    <DashboardClient
      initialReceipts={receipts}
      initialStats={stats}
      initialProducts={products}
      initialComparisons={comparisons}
      initialSuggestions={suggestions}
      initialPeriod={DEFAULT_TIME_PERIOD}
      authEnabled={isAuthEnabled()}
      isRemotePostgres={isUsingRemotePostgres()}
    />
  );
}
