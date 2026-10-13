import { Activity, AlertTriangle, BarChart3, Bitcoin, Diamond } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatIndicatorPrice,
  formatIndicatorTime,
  formatRsi,
  formatSignedPercent,
  formatUnsignedPercent,
} from "@/lib/strategy/format";
import type { StoredStrategyAnalysis, StrategyPageData } from "@/lib/strategy/types";

function signalStyle(signal: StoredStrategyAnalysis["signal"]) {
  if (signal === "BUY") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (signal === "SELL") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function AnalysisCard({ analysis }: { analysis: StoredStrategyAnalysis }) {
  const isBitcoin = analysis.product === "BTC-EUR";
  const Icon = isBitcoin ? Bitcoin : Diamond;
  const indicators = analysis.indicators;
  return (
    <Card className="gap-5 shadow-none" data-testid={`analysis-${analysis.product}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`flex size-10 items-center justify-center rounded-xl ${isBitcoin ? "bg-amber-50 text-amber-700" : "bg-indigo-50 text-indigo-600"}`}>
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div><CardTitle>{isBitcoin ? "Bitcoin" : "Ethereum"}</CardTitle><CardDescription>{analysis.product}</CardDescription></div>
        </div>
        <Badge variant="outline" className={signalStyle(analysis.signal)}>{analysis.signal} candidate</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border bg-muted/25 p-4">
          <p className="text-sm leading-6">{analysis.explanation}</p>
          <p className="mt-2 text-xs text-muted-foreground">Reasons: {analysis.reasonCodes.join(", ")}</p>
        </div>
        {indicators ? (
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">Latest close</dt><dd className="mt-1 font-semibold tabular-nums">{formatIndicatorPrice(indicators.latestClose)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">SMA20</dt><dd className="mt-1 font-semibold tabular-nums">{formatIndicatorPrice(indicators.sma20)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">SMA50</dt><dd className="mt-1 font-semibold tabular-nums">{formatIndicatorPrice(indicators.sma50)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">RSI14</dt><dd className="mt-1 font-semibold tabular-nums">{formatRsi(indicators.rsi14)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">7-day momentum</dt><dd className="mt-1 font-semibold tabular-nums">{formatSignedPercent(indicators.momentum7)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">30-day momentum</dt><dd className="mt-1 font-semibold tabular-nums">{formatSignedPercent(indicators.momentum30)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">30-day annualised volatility</dt><dd className="mt-1 font-semibold tabular-nums">{formatUnsignedPercent(indicators.volatility30Annualized)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Input candles</dt><dd className="mt-1 font-semibold tabular-nums">{indicators.inputCount}</dd></div>
          </dl>
        ) : (
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p className="text-sm">Indicators unavailable. This analysis remains HOLD and cannot become an order.</p>
          </div>
        )}
        <dl className="space-y-2 border-t pt-4 text-xs">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Latest completed candle</dt><dd className="font-medium tabular-nums">{analysis.latestCandleStart ? formatIndicatorTime(analysis.latestCandleStart) : "Unavailable"}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">UTC analysis cutoff</dt><dd className="font-medium tabular-nums">{formatIndicatorTime(analysis.cutoff)}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Data quality</dt><dd className="font-medium">{analysis.dataQuality} · {analysis.freshness}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Strategy</dt><dd className="font-medium">{analysis.strategyId} · {analysis.calculationVersion}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Approval stages</dt><dd className="font-medium">AI not requested · Risk not evaluated</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Recorded</dt><dd className="font-medium tabular-nums">{formatIndicatorTime(analysis.createdAt)}</dd></div>
        </dl>
        {analysis.proposedNotional && <p className="text-xs text-muted-foreground">Informational proposed maximum: {formatIndicatorPrice(analysis.proposedNotional)}. Risk approval has not run.</p>}
        {analysis.proposedQuantity && <p className="text-xs text-muted-foreground">Informational proposed maximum quantity: {analysis.proposedQuantity}. Risk approval has not run.</p>}
      </CardContent>
    </Card>
  );
}

export function AnalysisOverview({ data }: { data: StrategyPageData }) {
  if (data.status === "error") return <Card className="shadow-none"><CardContent><EmptyState icon={AlertTriangle} title="Analysis unavailable" description="Strategy records could not be loaded. No order was created; retry when the database is available." /></CardContent></Card>;
  if (data.status === "empty") return <Card className="shadow-none"><CardContent><EmptyState icon={BarChart3} title="No analysis preview yet" description="Run the deterministic strategy against the latest validated completed daily candles." /></CardContent></Card>;
  return (
    <section aria-labelledby="analysis-results-title" className="space-y-4">
      <div><h2 id="analysis-results-title" className="text-lg font-semibold">Latest deterministic previews</h2><p className="mt-1 text-sm text-muted-foreground">Persisted analysis records are auditable and idempotent. They are not trades.</p></div>
      <div className="grid gap-4 xl:grid-cols-2">{data.analyses.map((analysis) => <AnalysisCard key={analysis.id} analysis={analysis} />)}</div>
      <div className="flex gap-3 rounded-xl border bg-card p-4 text-sm text-muted-foreground"><Activity aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><p>SELL is evaluated before BUY. A candidate still requires future risk, AI and broker stages that are outside this phase.</p></div>
    </section>
  );
}
