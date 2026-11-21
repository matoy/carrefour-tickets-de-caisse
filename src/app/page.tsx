import { redirect } from "next/navigation";
import {
  createBookmarkletToken,
  isAuthEnabled,
  isRequestAuthenticated,
} from "@/lib/auth";
import { isUsingRemotePostgres } from "@/lib/db";
import {
  getSyncSetting,
  listAggregatedProducts,
  listReceipts,
} from "@/lib/db/receipt-service";
import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authenticated = await isRequestAuthenticated();
  if (!authenticated) {
    redirect("/login");
  }

  const [{ receipts, stats }, products, savedSession] = await Promise.all([
    listReceipts(true),
    listAggregatedProducts(),
    getSyncSetting("carrefour_session_cookie"),
  ]);

  return (
    <DashboardClient
      initialReceipts={receipts}
      initialStats={stats}
      initialProducts={products}
      syncToken={createBookmarkletToken()}
      hasSavedSession={Boolean(savedSession)}
      authEnabled={isAuthEnabled()}
      isRemotePostgres={isUsingRemotePostgres()}
    />
  );
}
