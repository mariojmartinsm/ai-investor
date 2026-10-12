"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { login } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

export function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  const [state, action, pending] = useActionState(login, { error: null });
  const inputClasses = "min-h-11 w-full rounded-md border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" autoCapitalize="none" required maxLength={254} disabled={!configured || pending} className={inputClasses} />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} disabled={!configured || pending} className={inputClasses} />
      </div>
      <div aria-live="polite">
        {state.error && <p role="alert" className="text-sm leading-6 text-destructive">{state.error}</p>}
        {!configured && <p role="alert" className="text-sm leading-6 text-muted-foreground">Sign-in is currently unavailable. Please contact the workspace owner.</p>}
      </div>
      <Button type="submit" disabled={!configured || pending} className="min-h-11 w-full">
        {pending ? "Signing in…" : "Log in"}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>
    </form>
  );
}
