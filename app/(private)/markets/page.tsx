import type { Metadata } from "next";
import { MarketOverview } from "@/components/markets/market-overview";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getMarketPageData } from "@/lib/markets/server";

export const metadata: Metadata = { title: "Markets" };
export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  const { markets, renderedAt } = await getMarketPageData();
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Markets / Public Coinbase prices" title="Markets" description="Bitcoin and Ethereum market information, priced in EUR." action={<Badge variant="outline">Dry Run only</Badge>} />
      <MarketOverview initialData={markets} renderedAt={renderedAt} />
    </div>
  );
}
