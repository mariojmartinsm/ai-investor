import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, CircleHelp, Coins, FlaskConical, ShieldCheck, Wallet } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { AssetCard } from "@/components/portfolio/asset-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sampleAssets, samplePortfolio } from "@/lib/sample-data";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Dashboard / Portfolio overview" title="AI Investor" description="Your virtual portfolio, at a glance. A simple starting point for informed decisions." action={<Badge variant="outline" className="bg-card px-3 py-1.5 text-muted-foreground">Sample data</Badge>} />

      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Card className="gap-0 border-[#20354c] bg-[#152c43] text-white shadow-none">
          <CardContent className="pt-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-200">Virtual portfolio value</p>
              <Badge className="border-white/15 bg-white/10 text-white">Sample data</Badge>
            </div>
            <p className="mt-6 text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">{samplePortfolio.value}</p>
            <p className="mt-3 text-sm text-slate-200">Initial virtual balance · EUR</p>
            <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-white/15 pt-5 text-xs text-slate-200">
              <FlaskConical aria-hidden="true" className="size-4 text-emerald-300" />
              Illustrative balance only. No funds deposited or invested.
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Portfolio allocation</CardTitle>
            <CardDescription>Starting position · Sample data</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-5 h-2 rounded-full bg-primary" aria-hidden="true" />
            <dl className="space-y-4 text-sm">
              <div className="flex items-center justify-between gap-2"><dt className="flex items-center gap-2 text-muted-foreground"><Wallet aria-hidden="true" className="size-4 text-primary" /> EUR cash</dt><dd className="font-medium tabular-nums">{samplePortfolio.cash} <span className="ml-1 text-xs text-muted-foreground">100%</span></dd></div>
              <div className="flex items-center justify-between gap-2"><dt className="flex items-center gap-2 text-muted-foreground"><Coins aria-hidden="true" className="size-4" /> BTC + ETH</dt><dd className="font-medium tabular-nums">{samplePortfolio.cryptoValue} <span className="ml-1 text-xs text-muted-foreground">0%</span></dd></div>
            </dl>
            <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground">All sample capital starts in virtual cash. No portfolio has been created yet.</p>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="assets-heading">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="assets-heading" className="text-lg font-semibold tracking-tight">Your watchlist</h2>
          <Button variant="ghost" size="sm" asChild><Link href="/markets">View markets <ArrowRight aria-hidden="true" className="size-4" /></Link></Button>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {sampleAssets.map((asset) => <AssetCard key={asset.symbol} asset={asset} />)}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Card className="gap-0 shadow-none">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b pb-5">
            <div>
              <CardTitle className="text-base">Latest Agent Activity</CardTitle>
              <CardDescription className="mt-1">Future decisions will appear here.</CardDescription>
            </div>
            <Badge variant="secondary">Not yet configured</Badge>
          </CardHeader>
          <CardContent>
            <EmptyState icon={Bot} title="Your agent is waiting in the wings" description="The AI agent is not yet configured. There are no analyses, scheduled runs, or trades to display." />
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-accent"><ShieldCheck aria-hidden="true" className="size-5 text-primary" /></div>
            <CardTitle className="text-base">Explore with confidence</CardTitle>
            <CardDescription className="leading-6">This workspace uses sample data. Market feeds and automation are not yet configured.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-start gap-2.5"><FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><p className="text-muted-foreground">Dry Run is the only available mode.</p></div>
            <Button variant="outline" asChild className="w-full"><Link href="/live"><CircleHelp aria-hidden="true" className="size-4" /> About locked Live mode</Link></Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
