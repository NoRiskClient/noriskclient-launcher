import { Icon } from "@iconify/react";

export function ViewHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <header className="fw-line-b flex h-14 shrink-0 items-center gap-3 px-5">
      <Icon icon={icon} className="fw-accent h-4 w-4" />
      <h2 className="fw-name-lg fw-ink">{title}</h2>
    </header>
  );
}
