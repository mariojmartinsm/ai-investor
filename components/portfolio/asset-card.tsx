import { ArrowUpRight, Bitcoin, Diamond } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { sampleAssets } from "@/lib/sample-data";

export function AssetCard({ asset }: { asset: (typeof sampleAssets)[number] }) {
  const isBitcoin = asset.symbol === "BTC";
  const Icon = isBitcoin ? Bitcoin : Diamond;

  return (
    <Card className="gap-5 shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`flex size-10 items-center justify-center rounded-xl ${isBitcoin ? "bg-amber-50 text-amber-700" : "bg-indigo-50 text-indigo-600"}`}>
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">{asset.name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{asset.product}</p>
          </div>
        </div>
        <Badge variant="outline" className="text-muted-foreground">Placeholder</Badge>
      </CardHeader>
      <CardContent>
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Market price (placeholder)</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">— <span className="text-sm font-normal text-muted-foreground">EUR</span></p>
          </div>
          <ArrowUpRight aria-hidden="true" className="size-5 text-muted-foreground/40" />
        </div>
        <dl className="space-y-2 border-t pt-4 text-xs">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Sample holdings</dt><dd className="font-medium tabular-nums">{asset.holdings}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Sample value</dt><dd className="font-medium tabular-nums">{asset.value}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">No quote yet · Market data not connected</p>
      </CardContent>
    </Card>
  );
}
