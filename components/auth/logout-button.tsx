"use client";

import { useActionState } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const [state, action, pending] = useActionState(logout, { error: null });

  return (
    <form action={action}>
      <Button type="submit" variant="ghost" size="sm" disabled={pending} className="min-h-11">
        <LogOut aria-hidden="true" className="size-4" />
        {pending ? "Logging out…" : "Log out"}
      </Button>
      {state.error && <p role="alert" className="max-w-48 text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
