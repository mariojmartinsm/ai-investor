import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChartNoAxesCombined, LockKeyhole, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { safeReturnPath } from "@/lib/auth/redirect";
import { getAuthenticatedUser } from "@/lib/auth/user";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeReturnPath((await searchParams).next);
  if (await getAuthenticatedUser()) redirect(next);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center justify-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><ChartNoAxesCombined aria-hidden="true" className="size-6" /></span>
          <span className="text-xl font-semibold tracking-tight">AI Investor</span>
        </div>
        <Card className="shadow-none">
          <CardHeader>
            <Badge variant="secondary" className="mb-2 w-fit"><ShieldCheck aria-hidden="true" className="size-3" /> Private workspace</Badge>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <CardDescription className="leading-6">Log in to your Dry Run workspace.</CardDescription>
          </CardHeader>
          <CardContent><LoginForm next={next} configured={Boolean(getSupabaseConfig())} /></CardContent>
        </Card>
        <div className="mt-6 flex items-start justify-center gap-2 text-center text-xs leading-5 text-muted-foreground">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <p>Access is for existing accounts only.<br />Live trading remains locked and unavailable.</p>
        </div>
      </div>
    </main>
  );
}
