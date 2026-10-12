import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, description }: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center sm:py-14">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border bg-background">
        <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
