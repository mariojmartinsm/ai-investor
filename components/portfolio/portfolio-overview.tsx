import { Bitcoin, Clock3, Diamond, FlaskConical, Info, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMarketEur, formatMarketTime } from "@/lib/markets/format";
import { formatAllocation, formatEur, formatPercentage, formatQuantity } from "@/lib/portfolio/format";
import type { AssetValuation, PortfolioSummary } from "@/lib/portfolio/model";

function ValueRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd data-testid={testId} className="font-medium tabular-nums">{value}</dd></div>;
}

function AssetCard({ asset }: { asset: AssetValuation }) {
  const bitcoin = asset.symbol === "BTC";
  const Icon = bitcoin ? Bitcoin : Diamond;
  const quote = asset.valuationPrice;
  const statusLabel = asset.priceStatus === "fresh" ? "Fresh price" : asset.priceStatus === "stale" ? "Stale price" : "Price unavailable";
  return (
    <Card className="shadow-none" data-testid={`portfolio-asset-${asset.symbol.toLowerCase()}`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background"><Icon aria-hidden="true" className="size-5 text-primary" /></div>
          <div><CardTitle className="text-base">{bitcoin ? "Bitcoin" : "Ethereum"}</CardTitle><CardDescription className="mt-1">{asset.product}</CardDescription></div>
        </div>
        <Badge variant={asset.priceStatus === "fresh" ? "secondary" : "outline"}>{statusLabel}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs text-muted-foreground">Virtual quantity</p>
          <p data-testid={`portfolio-${asset.symbol.toLowerCase()}`} className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatQuantity(asset.quantity)} <span className="text-sm font-normal text-muted-foreground">{asset.symbol}</span></p>
        </div>
        <dl className="space-y-3 border-t pt-4 text-sm">
          <ValueRow label="EUR market value" value={asset.marketValue === null ? "Unavailable" : formatEur(asset.marketValue)} testId={`portfolio-${asset.symbol.toLowerCase()}-value`} />
          <ValueRow label="Portfolio allocation" value={asset.allocationPercent === null ? "Unavailable" : formatAllocation(asset.allocationPercent)} />
          <ValueRow label="Valuation price" value={quote === null ? "Unavailable" : formatMarketEur(quote.price)} />
        </dl>
        <div className="space-y-1 border-t pt-4 text-xs leading-5 text-muted-foreground">
          {quote ? <>
            <p>{quote.priceKind === "last_trade" ? "Last public trade" : "Public product reference"} · {quote.source}</p>
            <p>Price time: <time dateTime={quote.exchangeAt ?? quote.fetchedAt}>{formatMarketTime(quote.exchangeAt ?? quote.fetchedAt)}</time></p>
            <p>{quote.executionReferenceKind === "public_bid_ask" ? "Public bid/ask observed; execution is not guaranteed." : "Indicative reference; a complete bid/ask spread was unavailable."}</p>
          </> : <p>No validated persisted quote is available. No price or spread has been fabricated.</p>}
          {!asset.priceRequired && <p>This price does not affect NAV because the ledger quantity is zero.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function PortfolioOverview({ portfolio }: { portfolio: PortfolioSummary }) {
  const createdAt = new Intl.DateTimeFormat("en-IE", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(new Date(portfolio.createdAt));
  const valuationLabel = portfolio.valuationStatus === "fresh" ? "Fresh valuation"
    : portfolio.valuationStatus === "stale" ? "Stale valuation" : "Valuation unavailable";

  return (
    <section aria-label="Persisted virtual portfolio" className="space-y-5" data-testid="portfolio-summary">
      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Card className="gap-0 border-[#20354c] bg-[#152c43] text-white shadow-none">
          <CardContent className="pt-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-normal text-slate-200">Virtual portfolio NAV</h2>
              <Badge className="border-white/15 bg-white/10 text-white">{valuationLabel} · Dry Run</Badge>
            </div>
            <p data-testid="portfolio-total" className="mt-6 break-words text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">{portfolio.totalValue === null ? "Unavailable" : formatEur(portfolio.totalValue)}</p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-200">
              <p>Return since inception: <span data-testid="portfolio-return" className="font-medium tabular-nums">{portfolio.cumulativeReturnPercent === null ? "Unavailable" : formatPercentage(portfolio.cumulativeReturnPercent)}</span></p>
              <p>Valued at <time dateTime={portfolio.valuationAt}>{formatMarketTime(portfolio.valuationAt)}</time></p>
            </div>
            {portfolio.valuationStatus !== "fresh" && <p role="alert" className="mt-4 text-sm text-amber-200">A nonzero crypto holding does not have a fresh validated price. NAV and return are withheld.</p>}
            <div className="mt-8 flex items-start gap-2 border-t border-white/15 pt-5 text-xs leading-5 text-slate-200">
              <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-300" />
              Market prices mark virtual holdings only. They never change ledger balances and are not guaranteed execution prices.
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4 shadow-none">
          <CardHeader><CardTitle className="text-base">Cash and capital</CardTitle><CardDescription>Ledger-derived virtual EUR</CardDescription></CardHeader>
          <CardContent>
            <div className="flex items-center gap-3"><Wallet aria-hidden="true" className="size-5 text-primary" /><p data-testid="portfolio-eur" className="break-words text-3xl font-semibold tracking-tight tabular-nums">{formatEur(portfolio.eurBalance)}</p></div>
            <dl className="mt-6 space-y-3 border-t pt-4 text-sm">
              <ValueRow label="Invested capital" value={formatEur(portfolio.investedCapital)} />
              <ValueRow label="EUR allocation" value={portfolio.eurAllocationPercent === null ? "Unavailable" : formatAllocation(portfolio.eurAllocationPercent)} />
              <ValueRow label="Cumulative P&L" value={portfolio.cumulativePnl === null ? "Unavailable" : formatEur(portfolio.cumulativePnl)} testId="portfolio-pnl" />
              <ValueRow label="Cumulative fees" value={portfolio.cumulativeFees === null ? "Unavailable" : formatEur(portfolio.cumulativeFees)} />
            </dl>
            <p className="mt-5 text-xs leading-5 text-muted-foreground">Portfolio created <time dateTime={portfolio.createdAt}>{createdAt} UTC</time>. Starting capital is recorded once in the immutable ledger.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2">{portfolio.assets.map((asset) => <AssetCard key={asset.product} asset={asset} />)}</div>

      <Card className="shadow-none">
        <CardHeader className="flex flex-row items-start gap-3">
          <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
          <div><CardTitle className="text-base">P&amp;L availability</CardTitle><CardDescription className="mt-1">Total return is NAV minus the €500 initial capital.</CardDescription></div>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="rounded-lg border p-4"><p className="text-muted-foreground">Realised P&amp;L</p><p className="mt-1 font-medium">Unavailable</p></div>
          <div className="rounded-lg border p-4"><p className="text-muted-foreground">Unrealised P&amp;L</p><p className="mt-1 font-medium">Unavailable</p></div>
          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground sm:col-span-2"><Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Realised and unrealised P&amp;L require persisted fills and cost-basis records. They are not inferred from balances or public quotes.</p>
        </CardContent>
      </Card>
    </section>
  );
}
