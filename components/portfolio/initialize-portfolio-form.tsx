"use client";

import { useActionState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";

import { initializeDryRunPortfolio } from "@/app/(private)/dashboard/actions";
import { Button } from "@/components/ui/button";

export function InitializePortfolioForm() {
  const [state, action, pending] = useActionState(initializeDryRunPortfolio, { error: null });

  return (
    <form action={action} className="space-y-3">
      <Button type="submit" disabled={pending} className="min-h-11 w-full sm:w-auto">
        {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ArrowRight aria-hidden="true" className="size-4" />}
        {pending ? "Initializing portfolio…" : "Initialize virtual portfolio"}
      </Button>
      <div aria-live="polite">
        {state.error && <p role="alert" className="text-sm leading-6 text-destructive">{state.error}</p>}
      </div>
    </form>
  );
}
