import type { Metadata } from "next";
import { AnalysisForm } from "@/components/strategy/analysis-form";
import { AnalysisOverview } from "@/components/strategy/analysis-overview";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getStrategyPageData } from "@/lib/strategy/server";

export const metadata: Metadata = { title: "AI Agent" };
export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const data = await getStrategyPageData();
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Agent / Deterministic preview" title="Strategy analysis" description="Technical indicators and rules-based candidates from validated completed Coinbase daily candles." action={<Badge variant="outline">BASELINE_V1</Badge>} />
      <Card className="border-primary/20 bg-primary/[0.03] shadow-none">
        <CardContent className="space-y-4">
          <div><p className="font-semibold">Analysis only — no orders are executed.</p><p className="mt-1 text-sm leading-6 text-muted-foreground">BUY and SELL labels are unapproved rules-based candidates. Risk controls, AI review, scheduling and simulated execution are not active.</p></div>
          <AnalysisForm />
        </CardContent>
      </Card>
      <AnalysisOverview data={data} />
    </div>
  );
}
