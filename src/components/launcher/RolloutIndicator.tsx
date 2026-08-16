"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { useWindowFocus } from "../../hooks/useWindowFocus";
import { useThemeStore } from "../../store/useThemeStore";
import { Button } from "../ui/buttons/Button";
import { openExternalUrl } from "../../services/tauri-service";
import {
  getLauncherConfig,
  setLauncherConfig,
} from "../../services/launcher-config-service";
import { getPackRolloutConfig } from "../../services/flagsmith-service";

const ACTIVE_COLOR = "#f59e0b";
const FALLBACK_PCT = 5;
const DISCORD_URL = "https://discord.norisk.gg";

const POPOVER_WIDTH = 320; // px (matches w-[20rem])
const POPOVER_EST_HEIGHT = 260; // px (estimate for boundary calc)
const VERTICAL_GAP = 40; // px gap between cursor and popover bottom
const CURSOR_OFFSET = 12; // px fallback gap when popover flips below cursor
const CLOSE_DELAY = 150;

export function RolloutIndicator() {
  const { t } = useTranslation();
  const isWindowFocused = useWindowFocus();
  const accentColor = useThemeStore((s) => s.accentColor);
  const [inRollout, setInRollout] = useState(false);
  const [optedOut, setOptedOut] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    x: number;
    top?: number;
    bottom?: number;
  }>({ x: 0 });
  const [pct, setPct] = useState<number>(FALLBACK_PCT);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    invoke<boolean>("is_pack_rollout_active")
      .then(setInRollout)
      .catch(() => setInRollout(false));
    getLauncherConfig()
      .then((c) => setOptedOut(c.pack_rollout_override === "off"))
      .catch(() => {});
    getPackRolloutConfig()
      .then((c) => {
        if (typeof c.rollout_pct === "number") setPct(c.rollout_pct);
      })
      .catch(() => {});
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const computePosition = () => {
    if (!buttonRef.current) return { x: 0 };
    const rect = buttonRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const boltTop = rect.top;
    const boltBottom = rect.bottom;
    // Horizontal: centered on bolt, clamped to viewport.
    let x = cx - POPOVER_WIDTH / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - POPOVER_WIDTH - 8));
    // Vertical: anchor by `bottom` so popover height changes don't shift the gap.
    // popover bottom edge = boltTop - VERTICAL_GAP.
    if (boltTop - VERTICAL_GAP < POPOVER_EST_HEIGHT + 8) {
      // Not enough room above — flip below the bolt using `top` anchor.
      return { x, top: boltBottom + CURSOR_OFFSET };
    }
    return { x, bottom: window.innerHeight - (boltTop - VERTICAL_GAP) };
  };

  const handleIconEnter = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setPos(computePosition());
    setOpen(true);
  };

  const handleIconLeave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };

  const handlePopoverEnter = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const handlePopoverLeave = () => {
    setOpen(false);
  };

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const current = await getLauncherConfig();
      const newOverride = optedOut ? "auto" : "off";
      await setLauncherConfig({
        ...current,
        pack_rollout_override: newOverride,
      });
      setOptedOut(!optedOut);
    } catch (err) {
      console.error("[RolloutIndicator] Failed to toggle rollout override:", err);
    }
  };

  if (!inRollout) return null;

  const iconColor = optedOut ? undefined : ACTIVE_COLOR;
  // Only pulse while the window is focused — a CSS `infinite` animation keeps
  // driving the GPU even when the launcher is minimized/hidden (issue #40).
  const animate = !optedOut && isWindowFocused;

  return (
    <div
      className="relative w-full h-full"
      onMouseEnter={handleIconEnter}
      onMouseLeave={handleIconLeave}
    >
      {/* Static glow layer. Rendered once and never animated, so the GPU does
          not re-rasterize the drop-shadow blur every frame. The pulsing icon
          below carries no filter, keeping the animation a cheap composite. */}
      {!optedOut && (
        <Icon
          icon="solar:bolt-bold"
          aria-hidden
          className="pointer-events-none absolute inset-0 w-full h-full"
          style={{
            color: ACTIVE_COLOR,
            filter: `drop-shadow(0 0 8px ${ACTIVE_COLOR})`,
          }}
        />
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={cn(
          "relative w-full h-full flex items-center justify-center cursor-pointer",
          optedOut ? "opacity-40 grayscale" : "",
          animate ? "animate-pulse" : "",
        )}
        style={optedOut ? undefined : { color: ACTIVE_COLOR }}
        aria-label={
          optedOut
            ? t("rollout.popover.click_to_opt_in")
            : t("rollout.popover.click_to_opt_out")
        }
      >
        <Icon icon="solar:bolt-bold" className="w-full h-full" />
      </button>

      {open &&
        createPortal(
          <div
            className="fixed z-[1000] w-[20rem] animate-slide-up-fade-in border border-b-2 rounded-md overflow-hidden"
            style={{
              left: pos.x,
              top: pos.top,
              bottom: pos.bottom,
              backgroundColor: `${accentColor.value}22`,
              borderColor: `${accentColor.value}80`,
              borderBottomColor: accentColor.value,
              backdropFilter: "blur(14px)",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.55)",
            }}
            onMouseEnter={handlePopoverEnter}
            onMouseLeave={handlePopoverLeave}
          >
            <div
              className="flex items-center gap-2.5 px-4 py-3 border-b-2"
              style={{
                backgroundColor: `${accentColor.value}30`,
                borderColor: `${accentColor.value}60`,
              }}
            >
              <Icon
                icon="solar:bolt-bold"
                className="w-5 h-5 shrink-0"
                style={{
                  color: iconColor ?? "rgba(255,255,255,0.45)",
                  filter: optedOut ? "grayscale(1)" : undefined,
                }}
              />
              <h3 className="font-smallcaps text-sm text-white tracking-wide leading-none pt-1">
                {optedOut
                  ? t("rollout.popover.title_opted_out")
                  : t("rollout.popover.title")}
              </h3>
            </div>

            <div className="p-4 flex flex-col gap-3.5">
              {optedOut ? (
                <p className="font-minecraft text-sm text-white/80 leading-relaxed">
                  {t("rollout.popover.body_opted_out")}
                </p>
              ) : (
                <>
                  <p className="font-minecraft text-sm text-white/85 leading-relaxed">
                    {t("rollout.popover.body_intro_before")}
                    <span
                      className="font-bold mx-1"
                      style={{ color: ACTIVE_COLOR }}
                    >
                      {pct}%
                    </span>
                    {t("rollout.popover.body_intro_after")}
                  </p>
                  <p className="font-minecraft text-sm text-white/65 leading-relaxed">
                    {t("rollout.popover.body_bug")}
                  </p>
                </>
              )}

              {!optedOut && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Icon icon="ic:baseline-discord" className="w-5 h-5" />}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openExternalUrl(DISCORD_URL);
                  }}
                  className="w-full justify-center"
                >
                  {t("rollout.popover.report_on_discord")}
                </Button>
              )}

              <p className="font-minecraft text-xs tracking-wide text-white/45 text-center mt-1 lowercase">
                {optedOut
                  ? t("rollout.popover.click_to_opt_in")
                  : t("rollout.popover.click_to_opt_out")}
              </p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
