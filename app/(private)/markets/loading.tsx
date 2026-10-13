export default function MarketsLoading() {
  return <div role="status" aria-label="Loading market data" className="space-y-6"><p className="text-muted-foreground">Loading Coinbase market data…</p><div aria-hidden="true" className="grid gap-5 md:grid-cols-2">{[0, 1, 2, 3].map((key) => <div key={key} className="h-80 animate-pulse rounded-xl border bg-card" />)}</div></div>;
}
