import type { Metadata } from "next";
import { ChartNoAxesCombined } from "lucide-react";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Performance" };

export default function PerformancePage() {
  return <PlaceholderPage title="Performance" description="Track how a virtual portfolio performs over time, after costs." icon={ChartNoAxesCombined} sectionTitle="Portfolio performance" emptyTitle="A fresh start, without a track record" emptyDescription="Performance tracking and backtesting are not yet configured. Returns, drawdowns, fees, and benchmark comparisons need recorded data before they can be shown." />;
}
