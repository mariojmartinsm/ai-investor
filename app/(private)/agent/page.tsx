import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "AI Agent" };

export default function AgentPage() {
  return <PlaceholderPage title="AI Agent" description="Understand the reasoning behind future Dry Run decisions." icon={Bot} sectionTitle="Agent workspace" emptyTitle="Agent not yet configured" emptyDescription="There is no AI provider, strategy, or daily schedule configured. Run history and decision explanations will appear here in a later milestone." />;
}
