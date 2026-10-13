import Link from "next/link";
import { ArrowUpRight, ChartNoAxesCombined, ChevronDown, LockKeyhole, Menu, ShieldCheck } from "lucide-react";

import { ModeStatus } from "@/components/layout/mode-status";
import { Navigation } from "@/components/layout/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { SessionSync } from "@/components/auth/session-sync";

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <ChartNoAxesCombined aria-hidden="true" className="size-5" />
      </span>
      <span className="text-base font-semibold tracking-tight">AI Investor</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <SessionSync />
      <a href="#main-content" className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col overflow-y-auto border-r bg-card p-5 lg:flex" aria-label="Workspace sidebar">
        <div className="px-2 pt-3 pb-10"><Brand /></div>
        <p className="mb-3 px-3 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Workspace</p>
        <Navigation />
        <div className="mt-auto rounded-xl border bg-background p-4">
          <ShieldCheck aria-hidden="true" className="mb-3 size-5 text-primary" />
          <p className="text-sm font-semibold">A virtual starting point</p>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Your portfolio uses virtual funds. Live mode is unavailable.</p>
          <Link href="/live" className="mt-4 flex items-center gap-2 rounded-sm text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            <LockKeyhole aria-hidden="true" className="size-3.5" />
            About Live mode
            <ArrowUpRight aria-hidden="true" className="ml-auto size-3.5" />
          </Link>
        </div>
        <p className="pt-5 text-center text-[11px] text-muted-foreground">AI Investor · Local prototype</p>
      </aside>

      <div className="lg:pl-60">
        <header className="border-b bg-card px-4 py-4 sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
            <div className="lg:hidden"><Brand /></div>
            <p className="hidden text-sm text-muted-foreground lg:block">Personal workspace <span className="mx-2 text-border">/</span> <span className="font-medium text-foreground">Virtual portfolio</span></p>
            <div className="flex flex-wrap items-center gap-2"><ModeStatus /><LogoutButton /></div>
          </div>
          <details className="mx-auto mt-4 max-w-7xl border-t pt-3 lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <Menu aria-hidden="true" className="size-4" />
              Navigation
              <ChevronDown aria-hidden="true" className="ml-auto size-4" />
            </summary>
            <div className="pt-2">
              <Navigation mobile />
              <Link href="/live" className="mt-2 flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                <LockKeyhole aria-hidden="true" className="size-4" />
                Live mode · Unavailable
              </Link>
            </div>
          </details>
        </header>

        <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-7 focus:outline-none sm:px-8 sm:py-9 lg:px-10">
          {children}
        </main>
        <footer className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-4 pt-2 pb-7 text-xs text-muted-foreground sm:px-8 lg:px-10">
          <p>Virtual funds only · Public Coinbase market data.</p>
          <p>Dry Run only · Live mode unavailable</p>
        </footer>
      </div>
    </div>
  );
}
