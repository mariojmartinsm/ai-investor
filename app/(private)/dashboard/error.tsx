"use client";

import { PortfolioError } from "@/components/portfolio/portfolio-error";

export default function DashboardError({ reset }: { reset: () => void }) {
  return <PortfolioError retry={reset} />;
}
