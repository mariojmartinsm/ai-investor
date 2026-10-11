import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <PageHeader eyebrow="Page not found" title="This page is off the map" description="Choose a workspace page from the navigation, or return to your dashboard." />
      <Button asChild><Link href="/dashboard">Back to dashboard</Link></Button>
    </>
  );
}
