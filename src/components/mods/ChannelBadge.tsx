const CHANNEL_STYLE: Record<string, { letter: string; className: string }> = {
  release: { letter: "R", className: "bg-emerald-500/15 text-emerald-300" },
  beta: { letter: "B", className: "bg-amber-500/15 text-amber-300" },
  alpha: { letter: "A", className: "bg-rose-500/15 text-rose-300" },
};

export function ChannelBadge({ releaseType }: { releaseType: string }) {
  const channel = CHANNEL_STYLE[releaseType] ?? CHANNEL_STYLE.release;
  return (
    <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center font-minecraft text-xs ${channel.className}`}>
      {channel.letter}
    </span>
  );
}
