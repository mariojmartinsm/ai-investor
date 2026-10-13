"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bitcoin, Diamond, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatMarketChange, formatMarketEur, formatMarketTime, formatMarketVolume } from "@/lib/markets/format";
import { MARKET_POLL_MS, type MarketSnapshot } from "@/lib/markets/types";
import { readMarketSnapshots, unavailableMarkets, visibleMarketSnapshot } from "@/lib/markets/view";

function MarketCard({ snapshot }: { snapshot: MarketSnapshot }) {
  const bitcoin = snapshot.product === "BTC-EUR";
  const symbol = bitcoin ? "BTC" : "ETH";
  const Icon = bitcoin ? Bitcoin : Diamond;
  const quote = snapshot.quote;
  const available = snapshot.status === "fresh" && quote !== null;
  return (
    <Card className="gap-5 shadow-none" data-testid={`market-card-${snapshot.product}`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`flex size-10 items-center justify-center rounded-xl ${bitcoin ? "bg-amber-50 text-amber-700" : "bg-indigo-50 text-indigo-600"}`}><Icon aria-hidden="true" className="size-5" /></span>
          <div><h2 className="font-semibold">{bitcoin ? "Bitcoin" : "Ethereum"} <span className="text-xs font-normal text-muted-foreground">{symbol}</span></h2><p className="mt-0.5 text-xs text-muted-foreground">{snapshot.product}</p></div>
        </div>
        <Badge data-testid={`market-status-${snapshot.product}`} variant={available ? "secondary" : "outline"}>{snapshot.status === "fresh" ? "Recent fetch" : snapshot.status === "stale" ? "Stale" : "Unavailable"}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-xs text-muted-foreground"><span>{quote?.priceKind === "last_trade" ? "Last trade price" : "Product reference price"}</span> · EUR</p>
          <p className="mt-1 break-words text-3xl font-semibold tracking-tight tabular-nums" data-testid={`market-price-${snapshot.product}`}>{available ? formatMarketEur(quote.price) : "Price unavailable"}</p>
        </div>
        {!available && <p role="status" className="text-sm text-muted-foreground">{snapshot.status === "stale" ? "The last confirmed data is stale. Waiting for an update." : "Market data is temporarily unavailable. Retrying automatically."}</p>}
        <dl className="space-y-3 border-t pt-4 text-sm">
          <MarketRow label="24-hour change" value={available && quote.change24h !== null ? formatMarketChange(quote.change24h) : "Unavailable"} />
          <MarketRow label="24-hour volume" value={available && quote.volume24h !== null ? `${formatMarketVolume(quote.volume24h)} ${symbol}` : "Unavailable"} />
          <MarketRow label="Best bid" value={available && quote.bid !== null ? formatMarketEur(quote.bid) : "Unavailable"} />
          <MarketRow label="Best ask" value={available && quote.ask !== null ? formatMarketEur(quote.ask) : "Unavailable"} />
        </dl>
        <div className="space-y-2 border-t pt-4 text-xs text-muted-foreground">
          <p>Coinbase Advanced Trade public API</p>
          <p><span>Fetched by app</span>: {quote ? <time dateTime={quote.fetchedAt}>{formatMarketTime(quote.fetchedAt)}</time> : "Not available"}</p>
          <p><span>Last trade on Coinbase</span>: {quote?.exchangeAt ? <time dateTime={quote.exchangeAt}>{formatMarketTime(quote.exchangeAt)}</time> : "Not provided"}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MarketRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-muted-foreground">{label}</dt><dd className="break-all font-medium tabular-nums">{value}</dd></div>;
}

export function MarketOverview({ initialData, renderedAt }: { initialData: MarketSnapshot[]; renderedAt: number }) {
  const [snapshots, setSnapshots] = useState(initialData);
  const [now, setNow] = useState(renderedAt);
  const lastAttempt = useRef(renderedAt);
  const inFlight = useRef(false);
  const router = useRouter();

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    async function poll() {
      if (document.visibilityState !== "visible" || inFlight.current || Date.now() - lastAttempt.current < MARKET_POLL_MS) return;
      inFlight.current = true;
      lastAttempt.current = Date.now();
      controller = new AbortController();
      try {
        const response = await fetch("/markets/data", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        if (disposed) return;
        if (response.redirected || response.status === 401 || response.status === 403) {
          setSnapshots(unavailableMarkets);
          router.replace("/login?next=/markets");
          return;
        }
        if (!response.ok) throw new Error("Market refresh failed");
        const data = readMarketSnapshots(await response.json());
        if (!disposed) setSnapshots(data);
      } catch {
        if (!disposed) setSnapshots(unavailableMarkets);
      } finally {
        inFlight.current = false;
        if (!disposed) setNow(Date.now());
      }
    }
    const onVisibility = () => { setNow(Date.now()); void poll(); };
    // Check the deadline on the freshness tick so a visibility-triggered
    // refresh does not make the next minute-aligned timer skip an update.
    const refresh = setInterval(() => { setNow(Date.now()); void poll(); }, 5_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return (
    <div className="space-y-5">
      <section aria-label="Coinbase EUR markets" className="grid gap-5 md:grid-cols-2">
        {snapshots.map((snapshot) => <MarketCard key={snapshot.product} snapshot={visibleMarketSnapshot(snapshot, now)} />)}
      </section>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span>Refreshes about every 60 seconds while this tab is visible. <span>Times shown in UTC. Last trade time does not date the bid/ask snapshot.</span> Prices are informational; your virtual portfolio is unchanged.</span></p>
    </div>
  );
}
