"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatMarketEur, formatMarketTime } from "@/lib/markets/format";
import type { HistoricalSeries } from "@/lib/markets/history/types";

const periods = [30, 90, 365] as const;
type Period = (typeof periods)[number];

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", day: "2-digit", month: "short" }).format(new Date(value));
}

function fullDate(value: string) {
  return new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { date: string; close: string } }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg"><p>{fullDate(point.date)} UTC</p><p className="mt-1 font-semibold">{formatMarketEur(point.close)}</p></div>;
}

function HistoricalChart({ series, period }: { series: HistoricalSeries; period: Period }) {
  const symbol = series.productId.slice(0, 3);
  const data = useMemo(() => series.candles.slice(-period).map((candle) => ({
    date: candle.candleStart,
    close: candle.close,
    value: Number(candle.close),
  })), [period, series.candles]);
  return (
    <Card className="gap-4 shadow-none" data-testid={`history-card-${series.productId}`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">{symbol === "BTC" ? "Bitcoin" : "Ethereum"} closing price</h3><p className="mt-1 text-xs text-muted-foreground">{series.productId} · fully closed UTC days</p></div>
        <Badge variant={series.complete ? "secondary" : "outline"}>{series.complete ? "Complete" : "Incomplete"}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.length === 0 ? (
          <div role="status" className="flex h-72 items-center justify-center rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground">No validated historical candles are stored yet.</div>
        ) : (
          <div className="h-72 w-full" data-testid={`history-chart-${series.productId}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 2 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" minTickGap={28} tickFormatter={shortDate} tick={{ fontSize: 11 }} />
                <YAxis width={76} domain={["auto", "auto"]} tickFormatter={(value: number) => `€${Math.round(value).toLocaleString("en-IE")}`} tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="space-y-1 text-xs text-muted-foreground">
          <p data-testid={`history-count-${series.productId}`}>Showing {data.length} daily closes.</p>
          <p>Coinbase Advanced Trade public API</p>
          <p>Last data update: {series.latestFetchedAt ? formatMarketTime(series.latestFetchedAt) : "Not available"}</p>
          {!series.complete && <p role="status">{series.gaps.length} missing day{series.gaps.length === 1 ? "" : "s"} in the requested 730-day history. Missing values are not interpolated.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function HistoryCharts({ status, series }: { status: "ready" | "empty" | "error"; series: HistoricalSeries[] }) {
  const [period, setPeriod] = useState<Period>(90);
  if (status === "error") return <section aria-label="Historical prices" className="rounded-xl border p-6"><h2 className="font-semibold">Historical prices</h2><p role="alert" className="mt-2 text-sm text-muted-foreground">Historical data could not be loaded. Try again shortly.</p></section>;
  return (
    <section aria-label="Historical prices" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="text-lg font-semibold">Historical closing prices</h2><p className="mt-1 text-sm text-muted-foreground">Validated daily Coinbase closes. Dates and hover details use UTC.</p></div>
        <div role="group" aria-label="Historical period" className="flex gap-1 rounded-lg border p-1">
          {periods.map((days) => <Button key={days} type="button" size="sm" variant={period === days ? "secondary" : "ghost"} aria-pressed={period === days} onClick={() => setPeriod(days)}>{days}D</Button>)}
        </div>
      </div>
      {status === "empty" && <p role="status" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No historical candles have been imported. Use the owner-only refresh action to load fully closed daily data.</p>}
      <div className="grid gap-5 xl:grid-cols-2">
        {series.map((item) => <HistoricalChart key={item.productId} series={item} period={period} />)}
      </div>
    </section>
  );
}
