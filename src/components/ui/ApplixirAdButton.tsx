import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "./buttons/Button";
import { Tooltip } from "./Tooltip";
import { getAfkPointsBalance, showApplixirAd } from "../../services/nrc-service";
import { useThemeStore } from "../../store/useThemeStore";
import { log } from "../../utils/logging-utils";

const APPLIXIR_ENABLED = false;

export function ApplixirAdButton() {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [playing, setPlaying] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (!APPLIXIR_ENABLED) return;
    const refresh = () => {
      getAfkPointsBalance()
        .then((b) => setStreak(b?.streakDays ?? 0))
        .catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  if (!APPLIXIR_ENABLED) return null;

  const handleClick = async () => {
    if (playing) return;
    setPlaying(true);
    try {
      log("info", "[ApplixirAdButton] opening ad window");
      await showApplixirAd();
      log("info", "[ApplixirAdButton] ad window opened");
    } catch (error) {
      log("error", `[ApplixirAdButton] failed to open ad window: ${JSON.stringify(error)}`);
      toast.error(t("applixir.failed"));
    } finally {
      setPlaying(false);
    }
  };

  return (
    <Tooltip content={t("applixir.disable_hint")} position="top">
      <Button
        variant="3d"
        size="sm"
        onClick={handleClick}
        disabled={playing}
        icon={playing ? <Loader2 className="w-5 h-5 animate-spin" /> : undefined}
      >
        <span className="inline-flex items-center gap-2 whitespace-nowrap leading-none">
          <span style={{ transform: "translateY(-2px)" }}>
            {t(playing ? "applixir.playing" : "applixir.daily_points")}
          </span>
          {!playing && (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: streak > 0 ? accentColor.light : "rgba(255,255,255,0.35)" }}
            >
              <Icon
                icon="solar:fire-bold"
                className="w-4 h-4"
                style={{ opacity: streak > 0 ? 1 : 0.5 }}
              />
              <span style={{ transform: "translateY(-2px)" }}>{streak}</span>
            </span>
          )}
        </span>
      </Button>
    </Tooltip>
  );
}
