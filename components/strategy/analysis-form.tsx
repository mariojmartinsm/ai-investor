"use client";

import { useActionState } from "react";
import { Play } from "lucide-react";

import { runAnalysis, type AnalysisActionState } from "@/app/(private)/agent/actions";
import { Button } from "@/components/ui/button";

const initialState: AnalysisActionState = { error: null, summary: null };

export function AnalysisForm() {
  const [state, action, pending] = useActionState(runAnalysis, initialState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>
        <Play aria-hidden="true" className={pending ? "animate-pulse" : ""} />
        {pending ? "Running analysis…" : "Run Analysis"}
      </Button>
      <span aria-live="polite" className={`text-xs ${state.error ? "text-destructive" : "text-muted-foreground"}`}>
        {state.error ?? state.summary}
      </span>
    </form>
  );
}
