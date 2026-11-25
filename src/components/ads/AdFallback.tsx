import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { getBorderRadiusClass, getVariantColors, createRadiusStyle } from "../ui/design-system";
import { PLAIN_TEXT } from "../ui/typography";
import { useSkinPreview } from "../../hooks/useSkinPreview";
import { openExternalUrl } from "../../services/tauri-service";
import { trackEvent } from "../../services/analytics-service";
import { NORISK_PLUS_URL } from "./AdPauseDialog";

const STEVE = "/skins/steve.png";
const SLIDE_MS = 20_000;

type Bones = Record<string, { rotation: [number, number, number] }>;

type Size = { width: number; height: number };

type Pose = Size & ({ emote: string; time: number } | { bones: Bones; rotation?: number });

const POSES: (Pose | null)[] = [
  { width: 126, height: 250, emote: "winner", time: 1.6 },
  {
    width: 115,
    height: 230,
    bones: {
      bipedHead: { rotation: [-15, 0, 0] },
      bipedRightArm: { rotation: [0, 0, 155] },
      bipedLeftArm: { rotation: [0, 0, -155] },
      bipedRightLeg: { rotation: [0, 0, 8] },
      bipedLeftLeg: { rotation: [0, 0, -8] },
    },
  },
  null,
  {
    width: 135,
    height: 270,
    rotation: -1.1,
    bones: {
      bipedHead: { rotation: [5, -50, 0] },
      bipedRightArm: { rotation: [-60, 0, 0] },
      bipedLeftArm: { rotation: [60, 0, 0] },
      bipedRightLeg: { rotation: [45, 0, 0] },
      bipedLeftLeg: { rotation: [-45, 0, 0] },
    },
  },
];

function useSteve(variant: number) {
  const pose = POSES[variant];
  const emote = pose && "emote" in pose ? pose : null;
  const rig = pose && "bones" in pose ? pose : null;
  return useSkinPreview(!!pose, {
    textureUrl: STEVE,
    variant: "slim",
    emote: emote ? { animation: `/emotes/fallback/${emote.emote}.animation.json` } : null,
    emoteTime: emote?.time,
    bones: rig?.bones,
    rotation: rig?.rotation,
    fit: true,
    width: pose?.width,
    height: pose?.height,
    fallbackUrl: null,
  });
}

function Cta({ children }: { children: ReactNode }) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const borderRadius = useThemeStore((state) => state.borderRadius);
  const colors = getVariantColors("flat", accentColor);
  return (
    <span
      className={cn(
        "flex h-[36px] w-fit items-center justify-center whitespace-nowrap border border-b-2 px-5 py-2 text-xs backdrop-blur-md",
        getBorderRadiusClass(borderRadius),
        PLAIN_TEXT,
      )}
      style={{
        backgroundColor: `${colors.main}30`,
        borderColor: `${colors.main}80`,
        borderBottomColor: colors.dark,
        color: colors.text,
        ...createRadiusStyle(borderRadius),
      }}
    >
      {children}
    </span>
  );
}

function Grid({ accent, size = 22 }: { accent: string; size?: number }) {
  return (
    <div
      className="absolute inset-0 opacity-25"
      style={{
        backgroundImage: `linear-gradient(${accent}40 1px, transparent 1px), linear-gradient(90deg, ${accent}40 1px, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
        maskImage: "linear-gradient(180deg, transparent, black)",
      }}
    />
  );
}

export function AdFallback() {
  const { t } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);
  const [variant, setVariant] = useState(0);
  const switched = useRef(false);
  useEffect(() => {
    const timer = window.setInterval(() => {
      switched.current = true;
      setVariant((current) => (current + 1) % POSES.length);
    }, SLIDE_MS);
    return () => window.clearInterval(timer);
  }, []);
  const steve = useSteve(variant);
  const title = t("ads.pause.forever");
  const tagline = t("ads.fallback.tagline");
  const cta = t("ads.fallback.cta");
  const base = `linear-gradient(160deg, ${accent}26, ${accent}08), rgba(0, 0, 0, 0.55)`;

  const designs = [
    <>
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 78% 70%, ${accent}59, transparent 62%), ${base}` }} />
      <Grid accent={accent} />
      <div className="relative flex w-[58%] flex-col justify-between p-4">
        <div className="space-y-2">
          <p className="text-lg leading-tight text-white">{title}</p>
          <p className="text-xs leading-snug text-white/60">{tagline}</p>
        </div>
        <Cta>{cta}</Cta>
      </div>
      <div className="relative w-[42%]">
        <Icon
          icon="solar:crown-bold"
          className="absolute left-[13px] top-[4px] z-10 h-8 w-8 text-amber-300 drop-shadow-[0_0_12px_rgba(252,211,77,0.7)]"
        />
        {steve.url && <img src={steve.url} alt="" draggable={false} className="absolute inset-x-0 bottom-0 top-10 h-[calc(100%-2.5rem)] w-full object-contain" style={{ filter: `drop-shadow(0 0 16px ${accent}59)` }} />}
      </div>
    </>,
    <>
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 110%, ${accent}80, transparent 60%), ${base}` }} />
      <Grid accent={accent} size={18} />
      {steve.url && (
        <img src={steve.url} alt="" draggable={false} className="absolute left-1/2 top-[30%] h-[230px] w-[115px] -translate-x-1/2 object-contain" style={{ filter: `drop-shadow(0 -4px 20px ${accent}80)` }} />
      )}
      <div className="relative flex w-full flex-col items-center gap-1 pt-4 text-center">
        <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: accent }}>NoRisk+</p>
        <p className="text-base leading-tight text-white">{title}</p>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/80 to-transparent pb-3 pt-8">
        <Cta>{cta}</Cta>
      </div>
    </>,
    <>
      <div className="absolute inset-0" style={{ background: base }} />
      <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full blur-3xl" style={{ background: `${accent}55` }} />
      <div className="absolute -bottom-12 -left-8 h-36 w-36 rounded-full blur-3xl" style={{ background: `${accent}33` }} />
      <div className="relative flex w-full flex-col justify-between p-5">
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Icon icon="solar:crown-bold" className="h-4 w-4 text-amber-300" />
          NoRisk+
        </div>
        <div className="space-y-2">
          <p className="text-[26px] leading-[1.05] text-white" style={{ textShadow: `0 0 24px ${accent}` }}>{title}</p>
          <p className="text-xs leading-snug text-white/60">{tagline}</p>
        </div>
        <div className="flex items-center justify-between">
          <Cta>{cta}</Cta>
          <Icon icon="solar:shield-check-bold" className="h-8 w-8 opacity-40" style={{ color: accent }} />
        </div>
      </div>
    </>,
    <>
      <div className="absolute inset-0" style={{ background: base }} />
      <div
        className="absolute inset-0 opacity-20"
        style={{ backgroundImage: `repeating-linear-gradient(135deg, ${accent}66 0 2px, transparent 2px 14px)` }}
      />
      <div className="absolute inset-y-0 right-0 w-1/2" style={{ background: `linear-gradient(90deg, transparent, ${accent}40)` }} />
      {steve.url && (
        <img src={steve.url} alt="" draggable={false} className="absolute -bottom-6 -right-2 h-[270px] w-[135px] rotate-[-6deg] object-contain" style={{ filter: `drop-shadow(0 0 18px ${accent}66)` }} />
      )}
      <div className="relative flex w-[62%] flex-col justify-center gap-3 p-4">
        <span className="w-fit rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-black" style={{ background: accent }}>NoRisk+</span>
        <p className="text-xl leading-tight text-white">{title}</p>
        <p className="text-xs leading-snug text-white/60">{tagline}</p>
        <Cta>{cta}</Cta>
      </div>
    </>,
  ];

  return (
    <button
      type="button"
      onClick={() => {
        void trackEvent("ads_fallback_plus_clicked", { variant });
        void openExternalUrl(NORISK_PLUS_URL).catch(() => {});
      }}
      className="absolute inset-0 isolate flex cursor-pointer overflow-hidden text-left font-minecraft normal-case select-none"
    >
      <div key={variant} className={cn("absolute inset-0 flex", switched.current && "animate-in fade-in duration-700")}>{designs[variant]}</div>
    </button>
  );
}
