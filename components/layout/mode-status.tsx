import { FlaskConical, LockKeyhole } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ModeStatus() {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Application mode">
      <Badge className="gap-1.5 border-primary/15 bg-accent px-2.5 py-1.5 text-primary">
        <FlaskConical aria-hidden="true" className="size-3.5" />
        Dry Run
      </Badge>
      <Button variant="outline" size="sm" disabled aria-label="Live mode locked and unavailable" className="disabled:opacity-70">
        <LockKeyhole aria-hidden="true" className="size-3.5" />
        Live locked
      </Button>
    </div>
  );
}
