import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <PlaceholderPage title="Settings" description="The future home for account preferences and bounded Dry Run settings." icon={Settings} sectionTitle="Workspace settings" emptyTitle="Settings are not yet configured" emptyDescription="Account, risk, fee, and scheduling settings will be added in later milestones. The prototype has no editable settings and remains in Dry Run mode." />;
}
