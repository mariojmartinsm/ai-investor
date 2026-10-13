import { Bitcoin, Diamond, FlaskConical, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatEur, formatQuantity } from "@/lib/portfolio/format";
import type { PortfolioSummary } from "@/lib/portfolio/model";

export function PortfolioOverview({ portfolio }: { portfolio: PortfolioSummary }) {
  const createdAt = new Intl.DateTimeFormat("en-IE", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(new Date(portfolio.createdAt));

  return (
    <section aria-label="Persisted virtual portfolio" className="space-y-5" data-testid="portfolio-summary">
      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Card className="gap-0 border-[#20354c] bg-[#152c43] text-white shadow-none">
          <CardContent className="pt-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-normal text-slate-200">Virtual portfolio value</h2>
              <Badge className="border-white/15 bg-white/10 text-white">Persisted · Dry Run</Badge>
            </div>
            <p data-testid="portfolio-total" className="mt-6 break-words text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">{formatEur(portfolio.totalValue)}</p>
            <p className="mt-3 text-sm text-slate-200">Virtual EUR · ledger-derived balance</p>
            <div className="mt-8 flex items-start gap-2 border-t border-white/15 pt-5 text-xs leading-5 text-slate-200">
              <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-300" />
              Virtual funds only. No real money is deposited or invested.
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Available EUR</CardTitle>
            <CardDescription>Persisted virtual cash</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Wallet aria-hidden="true" className="size-5 text-primary" />
              <p data-testid="portfolio-eur" className="break-words text-3xl font-semibold tracking-tight tabular-nums">{formatEur(portfolio.eurBalance)}</p>
            </div>
            <dl className="mt-6 space-y-3 border-t pt-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-muted-foreground">Starting capital</dt><dd className="font-medium tabular-nums">{formatEur(portfolio.startingCapital)}</dd></div>
              <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-muted-foreground">Cumulative P&amp;L</dt><dd data-testid="portfolio-pnl" className="font-medium tabular-nums">{formatEur(portfolio.cumulativePnl)}</dd></div>
            </dl>
            <p className="mt-5 text-xs leading-5 text-muted-foreground">Portfolio created <time dateTime={portfolio.createdAt}>{createdAt} UTC</time>. Starting capital is recorded once in the ledger.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {[
          { name: "Bitcoin", symbol: "BTC", product: "BTC-EUR", balance: portfolio.btcBalance, icon: Bitcoin },
          { name: "Ethereum", symbol: "ETH", product: "ETH-EUR", balance: portfolio.ethBalance, icon: Diamond },
        ].map(({ name, symbol, product, balance, icon: Icon }) => (
          <Card key={symbol} className="shadow-none">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background"><Icon aria-hidden="true" className="size-5 text-primary" /></div>
                <div><CardTitle className="text-base">{name}</CardTitle><CardDescription className="mt-1">{product}</CardDescription></div>
              </div>
              <Badge variant="outline">Virtual holdings</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{symbol} quantity</p>
              <p data-testid={`portfolio-${symbol.toLowerCase()}`} className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatQuantity(balance)} <span className="text-sm font-normal text-muted-foreground">{symbol}</span></p>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-sm"><span className="text-muted-foreground">Market price</span><span>— EUR <Badge variant="secondary" className="ml-1">Placeholder</Badge></span></div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">No market feed is connected. Quotes and trading are not configured.</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
