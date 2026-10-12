import type { Metadata } from "next";
import { ArrowLeftRight } from "lucide-react";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Trades" };

export default function TradesPage() {
  return <PlaceholderPage title="Trades" description="A future audit trail for simulated orders, fills, and costs." icon={ArrowLeftRight} sectionTitle="Simulated trade history" emptyTitle="No simulated trades yet" emptyDescription="The paper-trading engine is not yet configured. This page will show simulated fills and rejected orders with their decision explanations." />;
}
