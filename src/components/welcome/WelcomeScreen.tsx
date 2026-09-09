"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../store/useThemeStore";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { useWelcomeStore } from "../../store/welcome-store";
import { useAddMinecraftAccount } from "../../hooks/useAddMinecraftAccount";

/** Selling points on the hero half. Icons come from the offline bundle. */
const HIGHLIGHTS = [
  { icon: "solar:widget-add-bold", key: "mods" },
  { icon: "solar:hanger-2-bold", key: "capes" },
  { icon: "solar:bolt-bold", key: "fps" },
  { icon: "solar:layers-bold", key: "versions" },
] as const;

/**
 * Full-screen greeting for a launcher start with no account linked.
 *
 * Sits above the whole app rather than replacing the routed tree, so the
 * launcher boots normally behind it and dismissing costs nothing. It covers
 * the custom titlebar, so it carries its own drag region and window controls —
 * otherwise the window could not be moved or closed from here.
 */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const accent = useThemeStore((s) => s.accentColor).value;
  const animationsEnabled = useThemeStore((s) => s.isBackgroundAnimationEnabled);
  const isLoading = useMinecraftAuthStore((s) => s.isLoading);
  const skip = useWelcomeStore((s) => s.skip);
  const { startLogin } = useAddMinecraftAccount();

  // Parallax: the artwork drifts a little toward wherever the pointer is.
  // The listener sits on the whole overlay so it responds no matter which half
  // the pointer is over.
  //
  // Written straight to CSS custom properties rather than React state — a
  // rerender of the whole screen on every mouse move would be wasteful, and
  // these values only ever feed a transform.
  const rootRef = useRef<HTMLDivElement>(null);
  const onPointerMove = useCallback(
    (e: React.MouseEvent) => {
      const el = rootRef.current;
      if (!el || !animationsEnabled) return;
      el.style.setProperty("--px", `${(e.clientX / window.innerWidth - 0.5) * 2}`);
      el.style.setProperty("--py", `${(e.clientY / window.innerHeight - 0.5) * 2}`);
    },
    [animationsEnabled],
  );

  // Staggered entrance. Deliberately a keyframe animation over a base style
  // that is already visible, rather than a JS flag driving opacity 0 -> 1:
  // if the animation never runs — reduced motion, a throttled compositor, a
  // webview that mounts while off screen — the element is simply there. Gating
  // visibility on an animation completing risks a permanently blank first
  // screen, which is the one screen that must never fail to draw.
  const rise = (delayMs: number) =>
    ({
      animation: `welcome-rise 550ms cubic-bezier(0.22,1,0.36,1) ${delayMs}ms backwards`,
    }) as React.CSSProperties;

  const handleWindow = async (action: "minimize" | "toggleMaximize" | "close") => {
    const mod = await import("@tauri-apps/api/window").catch(() => null);
    if (!mod) return;
    const win = mod.getCurrentWindow();
    if (action === "minimize") await win.minimize();
    else if (action === "toggleMaximize") await win.toggleMaximize();
    else await win.close();
  };

  return (
    <div
      ref={rootRef}
      onMouseMove={onPointerMove}
      className="welcome-screen fixed inset-0 z-[900] flex bg-[#08060d] select-none"
      style={{ ["--px" as string]: 0, ["--py" as string]: 0 }}
    >
      <style>{`
        @keyframes welcome-rise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: none; }
        }
        /* Slow ambient drift so the hero breathes even with the pointer still. */
        @keyframes welcome-drift {
          0%, 100% { transform: scale(1.04) translate3d(0, 0, 0); }
          50%      { transform: scale(1.08) translate3d(-1.2%, -0.8%, 0); }
        }
        @keyframes welcome-sweep {
          from { transform: translateX(0); }
          to   { transform: translateX(420%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .welcome-art { animation: none !important; }
        }
        /* globals.css forces every Tailwind rounding utility — rounded-full
           included — to var(--border-radius) !important, which is 0px by
           default (the "Border Radius" setting, Minecraft-style square). A
           utility class therefore cannot round anything here. This rule
           needs more specificity than BOTH that override and
           .radius-themed button:not(.no-radius), which is what keeps buttons
           square even when the utility override is beaten. The doubled class
           gets there without enumerating element types, and leaves the global
           token everything else still follows untouched. */
        .welcome-screen .welcome-round.welcome-round { border-radius: 14px !important; }
      `}</style>

      {/* Titlebar strip: drag region + controls, floating over both halves. */}
      <div
        data-tauri-drag-region
        className="absolute top-0 inset-x-0 h-10 z-30 flex items-center justify-end px-4 gap-3"
      >
        {([
          ["minimize", "pixel:minus-solid", "window.minimize"],
          ["toggleMaximize", "pixel:expand-solid", "window.maximize"],
          ["close", "pixel:window-close-solid", "window.close"],
        ] as const).map(([action, icon, labelKey]) => (
          <button
            key={action}
            onClick={() => handleWindow(action)}
            title={t(labelKey)}
            className={`w-5 h-5 flex items-center justify-center text-white/50 transition-colors ${
              action === "close" ? "hover:text-red-500" : "hover:text-white"
            }`}
          >
            <Icon icon={icon} className="w-4 h-4" />
          </button>
        ))}
      </div>

      {/* ── Hero half ──────────────────────────────────────────────────── */}
      <div className="relative hidden md:flex flex-col justify-between flex-1 min-w-0 overflow-hidden p-12">
        {/* Layer 1 — the artwork, pushed far back: dimmed, desaturated and
            off-centred so it reads as texture under the copy rather than as a
            competing picture. Follows the pointer. */}
        <div
          aria-hidden
          className="absolute inset-0 overflow-hidden"
          style={{
            transform: "translate3d(calc(var(--px) * 20px), calc(var(--py) * 15px), 0)",
            transition: "transform 140ms ease-out",
          }}
        >
          <div
            className="welcome-art absolute inset-0 bg-cover opacity-[0.55] saturate-[0.9]"
            style={{
              backgroundImage: "url(/welcome-background.jpg)",
              backgroundPosition: "46% 52%",
              animation: "welcome-drift 18s ease-in-out infinite",
            }}
          />
        </div>

        {/* Layer 2 — accent bloom. Stays put; only the artwork moves. */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(85% 65% at 14% 86%, ${accent}5c 0%, transparent 62%)`,
          }}
        />

        {/* Layer 3 — fixed vignette. Never moves: it is what guarantees the copy
            keeps its contrast wherever the parallax happens to land. */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              `linear-gradient(180deg, #08060dcc 0%, transparent 28%, #08060d 100%),` +
              `linear-gradient(90deg, transparent 55%, #08060d 100%)`,
          }}
        />

        {/* The wordmark is type, not an image — the same treatment the app
            header uses. The painted logo asset is not the current brand. */}
        <div className="relative z-10" style={rise(60)}>
          <span className="font-smallcaps text-3xl tracking-wider font-bold text-white text-shadow">
            NoRiskClient
          </span>
        </div>

        <div className="relative z-10">
          <h1
            className="font-smallcaps text-white leading-[0.95] text-[clamp(2.5rem,4.4vw,4.25rem)] max-w-[16ch]"
            style={rise(140)}
          >
            {t("welcome.hero.line1")}
            <br />
            <span style={{ color: accent }}>{t("welcome.hero.line2")}</span>
          </h1>

          <div className="mt-9 flex flex-wrap gap-2.5 max-w-[30rem]">
            {HIGHLIGHTS.map((h, i) => (
              <div
                key={h.key}
                style={rise(240 + i * 70)}
                className="welcome-round flex items-center gap-2.5 pl-2.5 pr-4 py-2 border border-white/10 bg-white/[0.04] backdrop-blur-sm"
              >
                <span
                  className="welcome-round w-8 h-8 flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${accent}26` }}
                >
                  <Icon icon={h.icon} className="w-4.5 h-4.5" style={{ color: accent }} />
                </span>
                <span className="text-xs font-minecraft text-white/75 whitespace-nowrap">
                  {t(`welcome.highlight.${h.key}`)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Sign-in half ───────────────────────────────────────────────── */}
      <div
        className="relative w-full md:w-[clamp(24rem,34%,30rem)] flex-shrink-0 flex flex-col justify-center px-10 py-12 border-l border-white/[0.07] bg-[#0b0812]"
        style={{ boxShadow: "-24px 0 60px -30px rgba(0,0,0,0.9)" }}
      >
        {/* Faint accent wash so the panel is not a flat black slab. */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(120% 55% at 50% 0%, ${accent}1a 0%, transparent 60%)` }}
        />

        <div className="relative flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt=""
            className="w-16 h-16 mb-6 drop-shadow-[0_0_28px_rgba(255,255,255,0.18)]"
            style={rise(80)}
          />

          <h2 className="text-4xl font-smallcaps text-white" style={rise(160)}>
            {t("welcome.panel.title")}
          </h2>
          <p className="mt-3 text-sm font-minecraft text-white/55 leading-relaxed" style={rise(220)}>
            {t("welcome.panel.subtitle")}
          </p>

          <div className="w-full mt-9" style={rise(300)}>
            <SignInButton
              accent={accent}
              loading={isLoading}
              onClick={startLogin}
              label={t("welcome.panel.cta")}
              loadingLabel={t("welcome.panel.cta_loading")}
            />

            <button
              onClick={skip}
              className="welcome-round mt-3 w-full py-2.5 text-xs font-minecraft text-white/40 hover:text-white/75 hover:bg-white/5 transition-colors"
            >
              {t("welcome.panel.skip")}
            </button>
          </div>

          <p
            className="mt-8 pt-5 border-t border-white/[0.07] w-full text-[11px] font-minecraft text-white/30 leading-relaxed"
            style={rise(380)}
          >
            {t("welcome.panel.footnote")}
          </p>
        </div>
      </div>
    </div>
  );
}

interface SignInButtonProps {
  accent: string;
  loading: boolean;
  onClick: () => void;
  label: string;
  loadingLabel: string;
}

/**
 * The one button this whole screen exists for, so it does not use the shared
 * `Button`: that one's hover only nudges its fill from 30% to 50% accent, which
 * reads as almost nothing on the largest control on screen. This one lifts,
 * deepens its accent glow and sweeps a highlight across.
 */
function SignInButton({ accent, loading, onClick, label, loadingLabel }: SignInButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const active = hovered && !loading;

  // Keyed so the sweep replays on every hover rather than only the first.
  const [sweepKey, setSweepKey] = useState(0);
  useEffect(() => {
    if (active) setSweepKey((k) => k + 1);
  }, [active]);

  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      className="welcome-round relative w-full h-[58px] overflow-hidden border font-smallcaps text-base tracking-wide text-white disabled:cursor-wait"
      style={{
        backgroundColor: active ? `${accent}59` : `${accent}33`,
        borderColor: active ? accent : `${accent}80`,
        boxShadow: active
          ? `0 10px 30px -8px ${accent}b3, inset 0 1px 0 ${accent}66`
          : `0 4px 14px -6px ${accent}80, inset 0 1px 0 ${accent}33`,
        transform: pressed ? "translateY(1px)" : active ? "translateY(-2px)" : "none",
        transition:
          "background-color 200ms ease, border-color 200ms ease, box-shadow 220ms ease, transform 160ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {active && (
        <span
          key={sweepKey}
          aria-hidden
          className="absolute inset-y-0 -left-1/2 w-1/2 pointer-events-none"
          style={{
            background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.22), transparent)",
            animation: "welcome-sweep 650ms ease-out",
          }}
        />
      )}

      <span className="relative flex items-center justify-center gap-3">
        <Icon
          icon={loading ? "svg-spinners:ring-resize" : "simple-icons:microsoft"}
          className="w-5 h-5"
        />
        {loading ? loadingLabel : label}
      </span>
    </button>
  );
}
