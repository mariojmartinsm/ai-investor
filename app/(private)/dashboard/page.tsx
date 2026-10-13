import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, CircleHelp, FlaskConical, ShieldCheck, Wallet } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { InitializePortfolioForm } from "@/components/portfolio/initialize-portfolio-form";
import { PortfolioError } from "@/components/portfolio/portfolio-error";
import { PortfolioOverview } from "@/components/portfolio/portfolio-overview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardPortfolio } from "@/lib/portfolio/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const result = await getDashboardPortfolio();

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Dashboard / Portfolio overview" title="AI Investor" description="Your persisted virtual portfolio, at a glance. All funds remain virtual." action={<Badge variant="outline" className="bg-card px-3 py-1.5 text-muted-foreground">Dry Run only</Badge>} />

      {result.status === "ready" && <PortfolioOverview portfolio={result.portfolio} />}
      {result.status === "error" && <PortfolioError />}
      {result.status === "empty" && (
        <Card className="shadow-none">
          <CardHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-2xl border bg-background"><Wallet aria-hidden="true" className="size-5 text-primary" /></div>
            <CardTitle>Your virtual portfolio is not initialized</CardTitle>
            <CardDescription className="max-w-xl leading-6">Create your Dry Run portfolio with €500 virtual EUR and zero BTC or ETH. The starting capital is recorded once, and your balances persist between sessions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <InitializePortfolioForm />
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />No real funds, market feeds, or trading are involved.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end"><Button variant="ghost" size="sm" asChild><Link href="/markets">View markets <ArrowRight aria-hidden="true" className="size-4" /></Link></Button></div>

      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Card className="gap-0 shadow-none">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b pb-5">
            <div><CardTitle className="text-base">Latest Agent Activity</CardTitle><CardDescription className="mt-1">Future decisions will appear here.</CardDescription></div>
            <Badge variant="secondary">Not yet configured</Badge>
          </CardHeader>
          <CardContent><EmptyState icon={Bot} title="Your agent is waiting in the wings" description="The AI agent is not yet configured. There are no analyses, scheduled runs, or trades to display." /></CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-accent"><ShieldCheck aria-hidden="true" className="size-5 text-primary" /></div>
            <CardTitle className="text-base">Explore with confidence</CardTitle>
            <CardDescription className="leading-6">Portfolio balances are persisted virtual funds. Public Coinbase prices are available on Markets; automation is not yet configured.</CardDescription>
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
