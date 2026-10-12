import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PlaceholderPage({ title, description, icon, sectionTitle, emptyTitle, emptyDescription }: {
  title: string;
  description: string;
  icon: LucideIcon;
  sectionTitle: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <>
      <PageHeader eyebrow="Workspace" title={title} description={description} action={<Badge variant="outline">Placeholder page</Badge>} />
      <Card className="shadow-none">
        <CardHeader className="border-b">
          <CardTitle className="text-lg">{sectionTitle}</CardTitle>
          <CardDescription>This section is not yet configured.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />
        </CardContent>
      </Card>
    </>
  );
}
