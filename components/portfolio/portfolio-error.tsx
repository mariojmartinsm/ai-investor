"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PortfolioError({ retry }: { retry?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Portfolio temporarily unavailable</CardTitle>
        <CardDescription role="alert">We could not load your virtual portfolio. Please try again.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" disabled={pending} onClick={() => startTransition(() => retry ? retry() : router.refresh())}>
          <RefreshCw aria-hidden="true" className={pending ? "size-4 animate-spin" : "size-4"} />
          {pending ? "Retrying…" : "Try again"}
        </Button>
      </CardContent>
    </Card>
  );
}
