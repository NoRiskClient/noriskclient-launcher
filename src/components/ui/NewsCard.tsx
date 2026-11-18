import type { CSSProperties } from "react";
import { cn } from "../../lib/utils";

interface NewsCardProps {
  title: string;
  imageUrl: string;
  accent: string;
  onOpen?: () => void;
}

export function NewsCard({ title, imageUrl, accent, onOpen }: NewsCardProps) {
  const Wrapper = onOpen ? "button" : "div";
  return (
    <Wrapper
      {...(onOpen ? { type: "button" as const, onClick: onOpen } : {})}
      title={title}
      className={cn(
        "group flex w-full flex-col gap-1 text-left outline-none",
        onOpen && "cursor-pointer",
      )}
      style={{ "--news-accent": accent } as CSSProperties}
    >
      <span className="w-full">
        <span
          className={cn(
            "block truncate font-smallcaps text-base text-white/70 transition-all duration-300",
            onOpen &&
              "group-hover:text-[var(--news-accent)] group-focus-visible:text-[var(--news-accent)] motion-safe:group-hover:translate-x-1",
          )}
        >
          {title}
        </span>
        {onOpen && (
          <span className="block h-0.5 w-0 rounded-full bg-[var(--news-accent)] transition-all duration-300 ease-out group-hover:w-full group-focus-visible:w-full" />
        )}
      </span>
      <span
        className={cn(
          "relative block w-full overflow-hidden rounded-lg border-2 border-white/10 pt-[56.25%] transition-all duration-300 ease-out",
          onOpen &&
            "group-hover:border-[var(--news-accent)] group-hover:shadow-[0_6px_18px_-4px_var(--news-accent)] group-focus-visible:border-[var(--news-accent)] motion-safe:group-hover:-translate-y-0.5 group-active:translate-y-0 group-active:scale-[0.98]",
        )}
      >
        <img
          src={imageUrl || "/placeholder.svg"}
          alt={title}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-all duration-500 ease-out",
            onOpen && "group-hover:brightness-110 motion-safe:group-hover:scale-110",
          )}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = "/placeholder.svg";
          }}
        />
        {onOpen && (
          <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -translate-x-[150%] skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 group-hover:opacity-100 motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-out motion-safe:group-hover:translate-x-[400%]" />
        )}
      </span>
    </Wrapper>
  );
}
