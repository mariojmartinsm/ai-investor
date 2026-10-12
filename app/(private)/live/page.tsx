import type { Metadata } from "next";
import { LockKeyhole } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Live mode locked" };

export default function LivePage() {
  return (
    <>
      <PageHeader eyebrow="Application mode" title="Live mode is locked" description="Dry Run is the only available mode for AI Investor v1." action={<Badge variant="outline"><LockKeyhole aria-hidden="true" className="size-3" /> Unavailable</Badge>} />
      <Card className="shadow-none">
        <CardContent>
          <EmptyState icon={LockKeyhole} title="Live trading is not available" description="AI Investor has no live execution functionality. This prototype cannot connect an exchange account, deposit funds, or submit real orders. A future live release requires separate approval and development." />
          <div className="flex justify-center pb-6"><Button disabled><LockKeyhole aria-hidden="true" className="size-4" /> Live mode unavailable</Button></div>
        </CardContent>
      </Card>
    </>
  );
}
