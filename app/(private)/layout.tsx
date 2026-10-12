import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <AppShell>{children}</AppShell>;
}
