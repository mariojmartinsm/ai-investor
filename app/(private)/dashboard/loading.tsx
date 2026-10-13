import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardLoading() {
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Dashboard / Portfolio overview" title="AI Investor" description="Your persisted virtual portfolio, at a glance." />
      <div role="status" aria-live="polite" className="space-y-5">
        <p className="text-sm text-muted-foreground">Loading your virtual portfolio…</p>
        <div className="grid gap-5 md:grid-cols-2" aria-hidden="true">
          {[0, 1].map((index) => <Card key={index} className="shadow-none"><CardContent><div className="h-36 animate-pulse rounded-md bg-muted" /></CardContent></Card>)}
        </div>
      </div>
    </div>
  );
}
