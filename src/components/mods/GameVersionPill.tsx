import { Tooltip } from "../ui/Tooltip";

export function GameVersionPill({ versions }: { versions: string[] }) {
  const needsTooltip = versions.length > 1 || (versions[0]?.length ?? 0) > 14;
  return (
    <Tooltip position="top" delay={600} content={needsTooltip ? versions.join(", ") : null}>
      <span className="min-w-0 flex items-center gap-1 font-minecraft text-xs normal-case">
        <span className="truncate px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-white/75">{versions[0]}</span>
        {versions.length > 1 && <span className="shrink-0 text-white/35">+{versions.length - 1}</span>}
      </span>
    </Tooltip>
  );
}
