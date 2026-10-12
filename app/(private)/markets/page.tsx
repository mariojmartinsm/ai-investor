import type { Metadata } from "next";
import { ChartCandlestick } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";
import { AssetCard } from "@/components/portfolio/asset-card";
import { sampleAssets } from "@/lib/sample-data";

export const metadata: Metadata = { title: "Markets" };

export default function MarketsPage() {
  return (
    <div className="space-y-6">
      <PlaceholderPage title="Markets" description="A dedicated view for Bitcoin and Ethereum, priced in EUR." icon={ChartCandlestick} sectionTitle="Market overview" emptyTitle="Market data is not connected" emptyDescription="BTC-EUR and ETH-EUR prices, completed daily candles, and quote timestamps will appear here when market data is configured." />
      <section aria-label="Placeholder asset cards" className="grid gap-5 md:grid-cols-2">
        {sampleAssets.map((asset) => <AssetCard key={asset.symbol} asset={asset} />)}
      </section>
    </div>
  );
}
