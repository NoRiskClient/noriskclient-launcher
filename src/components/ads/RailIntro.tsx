import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import { openExternalUrl } from "../../services/tauri-service";

interface RailIntroProps {
  title: string;
  tag?: string;
  description: string;
  feedbackUrl?: string;
  feedbackLabel?: string;
}

export function RailIntro({ title, tag, description, feedbackUrl, feedbackLabel }: RailIntroProps) {
  const accent = useThemeStore((state) => state.accentColor.value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-lg text-white">{title}</span>
        {tag && (
          <span className="text-[10px] uppercase tracking-wider" style={{ color: accent }}>
            {tag}
          </span>
        )}
        {feedbackUrl && (
          <button
            type="button"
            title={feedbackLabel}
            onClick={() => void openExternalUrl(feedbackUrl).catch(() => {})}
            className="ml-auto text-white/35 hover:text-white transition-colors"
          >
            <Icon icon="simple-icons:discord" className="w-4 h-4" />
          </button>
        )}
      </div>
      <p className="text-xs text-white/55 leading-relaxed">{description}</p>
    </div>
  );
}
