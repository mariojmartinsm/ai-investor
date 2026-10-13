"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";

import { refreshHistoricalMarkets, type HistoricalRefreshState } from "@/app/(private)/markets/actions";
import { Button } from "@/components/ui/button";

const initialState: HistoricalRefreshState = { error: null, summary: null };

export function HistoryRefreshForm() {
  const [state, action, pending] = useActionState(refreshHistoricalMarkets, initialState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="outline" disabled={pending}>
        <RefreshCw aria-hidden="true" className={pending ? "animate-spin" : ""} />
        {pending ? "Refreshing history…" : "Refresh daily history"}
      </Button>
      <span aria-live="polite" className={`text-xs ${state.error ? "text-destructive" : "text-muted-foreground"}`}>
        {state.error ?? state.summary}
      </span>
    </form>
  );
}
