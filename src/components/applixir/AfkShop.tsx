import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../store/useThemeStore";
import { Button } from "../ui/buttons/Button";
import { getAfkShopCatalog, purchaseAfkShopItem } from "../../services/nrc-service";
import { log } from "../../utils/logging-utils";
import type { AfkShopCatalogResponse, AfkShopItemDto } from "../../types/afkpoints";

type AfkRarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
type AfkShopCategory = "streak" | "boxes" | "cosmetics" | "launcher";
type AfkShopItemKind = "consumable" | "unlock" | "held";

interface AfkShopItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  price: number;
  rarity: AfkRarity;
  category: AfkShopCategory;
  kind: AfkShopItemKind;
  maxHeld?: number;
  badge?: string;
}

interface AfkShopSection {
  category: AfkShopCategory;
  titleKey: string;
  items: AfkShopItem[];
}

interface MappedCatalog {
  featured: AfkShopItem | null;
  endsInDays: number;
  sections: AfkShopSection[];
}

const RARITIES: AfkRarity[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
const CATEGORIES: AfkShopCategory[] = ["streak", "boxes", "cosmetics", "launcher"];
const CATEGORY_ORDER: AfkShopCategory[] = ["streak", "boxes", "cosmetics", "launcher"];

function grantKind(grant: { type: string; rentalDays?: unknown }): AfkShopItemKind {
  if (grant.type === "streak_freeze") return "held";
  if (grant.type === "cosmetic") return grant.rentalDays != null ? "consumable" : "unlock";
  if (grant.type === "launcher") return "unlock";
  return "consumable";
}

function mapItem(dto: AfkShopItemDto): AfkShopItem {
  const rarity = (RARITIES as string[]).includes(dto.rarity) ? (dto.rarity as AfkRarity) : "COMMON";
  const cat = dto.category.toLowerCase();
  const category = (CATEGORIES as string[]).includes(cat) ? (cat as AfkShopCategory) : "cosmetics";
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    icon: dto.icon || "solar:box-bold",
    price: dto.price,
    rarity,
    category,
    kind: grantKind(dto.grant),
    maxHeld: dto.maxOwned ?? undefined,
    badge: dto.badge ?? undefined,
  };
}

function mapCatalog(res: AfkShopCatalogResponse): MappedCatalog {
  const items = res.catalog.items.filter((i) => i.enabled).map(mapItem);
  const sections: AfkShopSection[] = CATEGORY_ORDER.map((category) => ({
    category,
    titleKey: `applixir.shop.cat.${category}`,
    items: items.filter((i) => i.category === category),
  })).filter((s) => s.items.length > 0);

  const endsAt = res.catalog.featuredEndsAt;
  const endsInDays = endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 86_400_000)) : 0;

  return {
    featured: res.catalog.featured && res.catalog.featured.enabled ? mapItem(res.catalog.featured) : null,
    endsInDays,
    sections,
  };
}

const RARITY: Record<AfkRarity, { base: string; bright: string }> = {
  COMMON: { base: "#757575", bright: "#cfcfcf" },
  UNCOMMON: { base: "#1c7c35", bright: "#4ade80" },
  RARE: { base: "#185695", bright: "#60a5fa" },
  EPIC: { base: "#7b25a4", bright: "#c084fc" },
  LEGENDARY: { base: "#a46823", bright: "#fbbf24" },
};


function PricePill({
  item,
  affordable,
  ownedLabel,
}: {
  item: AfkShopItem;
  affordable: boolean;
  ownedLabel: string | null;
}) {
  const colors = RARITY[item.rarity];
  return (
    <div
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border backdrop-blur-md shadow-lg"
      style={{
        backgroundColor: "rgba(10, 10, 12, 0.92)",
        borderColor: ownedLabel ? "rgba(255,255,255,0.25)" : `${colors.base}`,
      }}
    >
      {ownedLabel ? (
        <>
          <Icon icon="solar:check-circle-bold" className="w-3.5 h-3.5 text-green-400" />
          <span className="font-minecraft text-[11px] leading-none text-white/80" style={{ transform: "translateY(-1px)" }}>
            {ownedLabel}
          </span>
        </>
      ) : (
        <>
          <Icon
            icon="solar:bolt-circle-bold"
            className="w-3.5 h-3.5"
            style={{ color: affordable ? colors.bright : "rgba(255,255,255,0.3)" }}
          />
          <span
            className="font-minecraft text-[11px] leading-none"
            style={{
              color: affordable ? colors.bright : "rgba(255,255,255,0.35)",
              transform: "translateY(-1px)",
            }}
          >
            {item.price.toLocaleString()}
          </span>
        </>
      )}
    </div>
  );
}

function ShopCard({
  item,
  points,
  ownedCount,
  onClick,
}: {
  item: AfkShopItem;
  points: number;
  ownedCount: number;
  onClick: (item: AfkShopItem) => void;
}) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const [hovered, setHovered] = useState(false);
  const colors = RARITY[item.rarity];
  const affordable = points >= item.price;

  const maxedHeld = item.kind === "held" && item.maxHeld !== undefined && ownedCount >= item.maxHeld;
  const ownedUnlock = item.kind === "unlock" && ownedCount > 0;
  const soldOut = maxedHeld || ownedUnlock;

  const ownedLabel = ownedUnlock
    ? t("applixir.shop.owned")
    : maxedHeld
      ? `${ownedCount}/${item.maxHeld}`
      : null;

  const background = hovered && !soldOut
    ? `linear-gradient(180deg, ${colors.base}30 0%, ${colors.base}95 100%)`
    : `linear-gradient(180deg, rgba(8,8,10,0.7) 0%, ${colors.base}55 100%)`;

  return (
    <div className="relative pb-3">
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => !soldOut && onClick(item)}
        className="relative flex flex-col items-center justify-between aspect-square px-3 pt-3 pb-5 transition-all duration-150 select-none"
        style={{
          background,
          border: `1px solid ${hovered && !soldOut ? accentColor.value : "rgba(255,255,255,0.12)"}`,
          cursor: soldOut ? "default" : "pointer",
          opacity: soldOut ? 0.75 : 1,
        }}
      >
        {item.badge && (
          <span
            className="absolute top-1.5 right-1.5 font-minecraft text-[8px] tracking-wider px-1.5 py-0.5 rounded leading-none"
            style={{ color: colors.bright, backgroundColor: "rgba(0,0,0,0.55)", border: `1px solid ${colors.base}` }}
          >
            {item.badge}
          </span>
        )}
        {item.kind === "consumable" && ownedCount > 0 && (
          <span
            className="absolute top-1.5 left-1.5 font-minecraft text-[8px] px-1.5 py-0.5 rounded leading-none text-white/80"
            style={{ backgroundColor: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.2)" }}
          >
            x{ownedCount}
          </span>
        )}
        {item.kind === "held" && ownedCount > 0 && !maxedHeld && (
          <span
            className="absolute top-1.5 left-1.5 font-minecraft text-[8px] px-1.5 py-0.5 rounded leading-none text-white/80"
            style={{ backgroundColor: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.2)" }}
          >
            {ownedCount}/{item.maxHeld}
          </span>
        )}

        <div className="flex-1 flex items-center justify-center">
          <Icon
            icon={item.icon}
            className="w-9 h-9 transition-transform duration-150"
            style={{
              color: colors.bright,
              filter: `drop-shadow(0 0 ${hovered ? 10 : 5}px ${colors.base})`,
              transform: hovered && !soldOut ? "scale(1.12)" : "scale(1)",
            }}
          />
        </div>

        <span className="font-smallcaps text-xs tracking-wide text-white text-shadow text-center leading-tight">
          {item.name}
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex justify-center pointer-events-none">
        <PricePill item={item} affordable={affordable} ownedLabel={ownedLabel} />
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  const accentColor = useThemeStore((s) => s.accentColor);
  return (
    <div className="flex items-center gap-3 mt-1">
      <span className="font-smallcaps text-sm tracking-widest text-white/80 text-shadow shrink-0">
        {title}
      </span>
      <div
        className="flex-1 h-px"
        style={{ background: `linear-gradient(to right, ${accentColor.value}60, transparent)` }}
      />
    </div>
  );
}

function FeaturedBanner({
  item,
  endsInDays,
  points,
  owned,
  onClick,
}: {
  item: AfkShopItem;
  endsInDays: number;
  points: number;
  owned: boolean;
  onClick: (item: AfkShopItem) => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const accentColor = useThemeStore((s) => s.accentColor);
  const colors = RARITY.LEGENDARY;
  const affordable = points >= item.price;

  return (
    <div className="relative pb-3 shrink-0">
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => !owned && onClick(item)}
        className="relative flex items-center gap-5 px-5 py-4 overflow-hidden transition-all duration-150 select-none"
        style={{
          background: hovered && !owned
            ? `linear-gradient(115deg, ${colors.base}45 0%, rgba(8,8,10,0.75) 55%, ${colors.base}35 100%)`
            : `linear-gradient(115deg, ${colors.base}30 0%, rgba(8,8,10,0.8) 55%, ${colors.base}20 100%)`,
          border: `1px solid ${hovered && !owned ? accentColor.value : `${colors.base}80`}`,
          cursor: owned ? "default" : "pointer",
        }}
      >
        <Icon
          icon={item.icon}
          className="w-14 h-14 shrink-0 transition-transform duration-150"
          style={{
            color: colors.bright,
            filter: `drop-shadow(0 0 ${hovered ? 14 : 8}px ${colors.base})`,
            transform: hovered && !owned ? "scale(1.08)" : "scale(1)",
          }}
        />
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="font-minecraft text-[8px] tracking-widest px-1.5 py-0.5 rounded leading-none"
              style={{ color: colors.bright, backgroundColor: "rgba(0,0,0,0.5)", border: `1px solid ${colors.base}` }}
            >
              {t("applixir.shop.featured")}
            </span>
            {item.badge && (
              <span
                className="font-minecraft text-[8px] tracking-widest px-1.5 py-0.5 rounded leading-none text-white/60"
                style={{ backgroundColor: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)" }}
              >
                {item.badge}
              </span>
            )}
            <span className="font-minecraft text-[10px] text-white/40">
              {t("applixir.shop.ends_in", { days: endsInDays })}
            </span>
          </div>
          <span className="font-smallcaps text-xl tracking-wide text-white text-shadow leading-tight">
            {item.name}
          </span>
          <span className="font-minecraft text-[10px] text-white/50 leading-relaxed truncate">
            {item.description}
          </span>
        </div>
      </div>
      <div className="absolute bottom-0 right-8 pointer-events-none">
        <PricePill
          item={item}
          affordable={affordable}
          ownedLabel={owned ? t("applixir.shop.owned") : null}
        />
      </div>
    </div>
  );
}

type CheckoutPhase = "confirm" | "processing" | "success" | "error";

function CheckoutOverlay({
  item,
  purchaseId,
  points,
  onComplete,
  onClose,
}: {
  item: AfkShopItem;
  purchaseId: string;
  points: number;
  onComplete: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<CheckoutPhase>("confirm");
  const colors = RARITY[item.rarity];
  const affordable = points >= item.price;
  const locked = phase === "processing";

  const startPurchase = async () => {
    setPhase("processing");
    try {
      await purchaseAfkShopItem(item.id, purchaseId);
      await onComplete();
      setPhase("success");
      window.setTimeout(onClose, 1600);
    } catch (e) {
      log("error", `[AfkShop] purchase failed: ${JSON.stringify(e)}`);
      setPhase("error");
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => !locked && onClose()}
    >
      <div
        className="flex flex-col items-center gap-4 px-8 py-6 min-w-[320px]"
        style={{
          background: `linear-gradient(180deg, rgba(10,10,12,0.97) 0%, ${colors.base}30 100%)`,
          border: `1px solid ${phase === "success" ? "#4ade80" : phase === "error" ? "#ef4444" : colors.base}`,
          boxShadow: `0 0 40px rgba(0,0,0,0.8), 0 0 20px ${colors.base}40`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {phase === "success" ? (
          <div className="animate-slide-up-fade-in flex flex-col items-center gap-4">
            <Icon
              icon="solar:check-circle-bold"
              className="w-14 h-14 text-green-400"
              style={{ filter: "drop-shadow(0 0 12px rgba(74,222,128,0.6))" }}
            />
            <div className="flex flex-col items-center gap-1">
              <span className="font-smallcaps text-lg tracking-wide text-white text-shadow">
                {t("applixir.shop.success")}
              </span>
              <span className="font-minecraft text-[10px] text-white/60">{item.name}</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Icon icon="solar:bolt-circle-bold" className="w-4 h-4 text-white/50" />
              <span className="font-minecraft text-sm leading-none text-white/70" style={{ transform: "translateY(-1px)" }}>
                -{item.price.toLocaleString()}
              </span>
            </div>
          </div>
        ) : phase === "error" ? (
          <>
            <Icon
              icon="solar:danger-triangle-bold"
              className="w-14 h-14 text-red-500"
              style={{ filter: "drop-shadow(0 0 12px rgba(239,68,68,0.5))" }}
            />
            <span className="font-smallcaps text-lg tracking-wide text-white text-shadow">
              {t("applixir.shop.checkout_error")}
            </span>
            <div className="flex items-center gap-3">
              <Button variant="flat" size="sm" onClick={onClose}>
                <span style={{ transform: "translateY(-2px)" }}>{t("applixir.shop.cancel")}</span>
              </Button>
              <Button variant="flat" size="sm" onClick={startPurchase}>
                <span style={{ transform: "translateY(-2px)" }}>{t("applixir.window.try_again")}</span>
              </Button>
            </div>
          </>
        ) : (
          <>
            <Icon
              icon={item.icon}
              className="w-14 h-14"
              style={{ color: colors.bright, filter: `drop-shadow(0 0 10px ${colors.base})` }}
            />
            <div className="flex flex-col items-center gap-1">
              <span className="font-smallcaps text-lg tracking-wide text-white text-shadow">{item.name}</span>
              <span className="font-minecraft text-[10px] text-white/50 text-center max-w-[260px] leading-relaxed">
                {item.description}
              </span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Icon icon="solar:bolt-circle-bold" className="w-4 h-4" style={{ color: colors.bright }} />
              <span className="font-minecraft text-sm leading-none" style={{ color: colors.bright, transform: "translateY(-1px)" }}>
                {item.price.toLocaleString()}
              </span>
            </div>
            {phase === "processing" ? (
              <div className="flex items-center gap-2.5 h-9">
                <Icon icon="svg-spinners:ring-resize" className="w-5 h-5" style={{ color: colors.bright }} />
                <span className="font-minecraft text-[11px] text-white/60">
                  {t("applixir.shop.processing")}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button variant="flat" size="sm" onClick={onClose}>
                  <span style={{ transform: "translateY(-2px)" }}>{t("applixir.shop.cancel")}</span>
                </Button>
                <Button variant="flat" size="sm" disabled={!affordable} onClick={startPurchase}>
                  <span style={{ transform: "translateY(-2px)" }}>
                    {affordable ? t("applixir.shop.buy") : t("applixir.shop.insufficient")}
                  </span>
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CategorySidebar({
  categories,
  active,
  counts,
  onSelect,
}: {
  categories: { id: AfkShopCategory | "all"; labelKey: string; icon: string }[];
  active: AfkShopCategory | "all";
  counts: Record<string, number>;
  onSelect: (id: AfkShopCategory | "all") => void;
}) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);

  return (
    <div
      className="w-44 shrink-0 bg-black/20 backdrop-blur-lg py-3 px-2 flex flex-col gap-1"
      style={{
        borderRight: `2px solid ${accentColor.value}40`,
        boxShadow: `0 0 15px ${accentColor.borderValue || accentColor.textValue || accentColor.value}20 inset`,
      }}
    >
      {categories.map((cat) => {
        const isActive = active === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            className="relative flex items-center gap-2.5 px-3 py-2.5 transition-all duration-150 cursor-pointer text-left"
            style={{
              backgroundColor: isActive ? `${accentColor.value}22` : "transparent",
              border: `1px solid ${isActive ? `${accentColor.value}50` : "transparent"}`,
            }}
          >
            {isActive && (
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4/5 rounded-r"
                style={{ backgroundColor: (accentColor.borderValue || accentColor.textValue || accentColor.value), boxShadow: `0 0 8px ${accentColor.shadowValue}` }}
              />
            )}
            <Icon
              icon={cat.icon}
              className="w-4 h-4 shrink-0"
              style={{ color: isActive ? (accentColor.textValue || accentColor.value) : "rgba(255,255,255,0.4)" }}
            />
            <span
              className="font-smallcaps text-sm tracking-wide flex-1 leading-none"
              style={{ color: isActive ? "#ffffff" : "rgba(255,255,255,0.55)" }}
            >
              {t(cat.labelKey)}
            </span>
            <span
              className="font-minecraft text-[9px] leading-none"
              style={{ color: isActive ? accentColor.light : "rgba(255,255,255,0.25)" }}
            >
              {counts[cat.id] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StatusMessage({ icon, text, spin }: { icon: string; text: string; spin?: boolean }) {
  const accentColor = useThemeStore((s) => s.accentColor);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <Icon icon={icon} className={`w-10 h-10${spin ? " animate-spin" : ""}`} style={{ color: accentColor.textValue || accentColor.value }} />
      <span className="font-minecraft text-xs text-white/60">{text}</span>
    </div>
  );
}

export function AfkShop({ onBalanceChange }: { onBalanceChange?: (afkPoints: number) => void }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<AfkShopCategory | "all">("all");
  const [pending, setPending] = useState<{ item: AfkShopItem; purchaseId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [afkPoints, setAfkPoints] = useState(0);
  const [ownedCounts, setOwnedCounts] = useState<Record<string, number>>({});
  const [mapped, setMapped] = useState<MappedCatalog | null>(null);

  const load = async () => {
    try {
      const res = await getAfkShopCatalog();
      if (!res) {
        setFailed(true);
        return;
      }
      setAfkPoints(res.afkPoints);
      setOwnedCounts(res.ownedCounts ?? {});
      setMapped(mapCatalog(res));
      setFailed(false);
      onBalanceChange?.(res.afkPoints);
    } catch (e) {
      log("error", `[AfkShop] catalog load failed: ${JSON.stringify(e)}`);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const sections = useMemo(
    () => (mapped?.sections ?? []).filter((s) => category === "all" || s.category === category),
    [mapped, category],
  );

  const counts = useMemo(() => {
    const per: Record<string, number> = { all: 0 };
    for (const s of mapped?.sections ?? []) {
      per[s.category] = s.items.length;
      per.all += s.items.length;
    }
    return per;
  }, [mapped]);

  const categories: { id: AfkShopCategory | "all"; labelKey: string; icon: string }[] = [
    { id: "all", labelKey: "applixir.shop.cat.all", icon: "solar:widget-bold" },
    { id: "streak", labelKey: "applixir.shop.cat.streak", icon: "solar:fire-bold" },
    { id: "boxes", labelKey: "applixir.shop.cat.boxes", icon: "solar:box-bold" },
    { id: "cosmetics", labelKey: "applixir.shop.cat.cosmetics", icon: "solar:hanger-bold" },
    { id: "launcher", labelKey: "applixir.shop.cat.launcher", icon: "solar:tuning-square-bold" },
  ];

  const openCheckout = (item: AfkShopItem) => setPending({ item, purchaseId: crypto.randomUUID() });

  if (loading) {
    return <StatusMessage icon="svg-spinners:ring-resize" text={t("applixir.shop.loading")} />;
  }
  if (failed || !mapped) {
    return <StatusMessage icon="solar:danger-triangle-bold" text={t("applixir.shop.load_error")} />;
  }
  if (mapped.sections.length === 0 && !mapped.featured) {
    return <StatusMessage icon="solar:box-bold" text={t("applixir.shop.empty")} />;
  }

  return (
    <div className="relative flex flex-1 min-h-0">
      <CategorySidebar
        categories={categories}
        active={category}
        counts={counts}
        onSelect={setCategory}
      />

      <div className="flex flex-col flex-1 min-w-0 min-h-0 p-4">
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-2 flex flex-col gap-3">
          {mapped.featured && category === "all" && (
            <FeaturedBanner
              item={mapped.featured}
              endsInDays={mapped.endsInDays}
              points={afkPoints}
              owned={(ownedCounts[mapped.featured.id] ?? 0) > 0}
              onClick={openCheckout}
            />
          )}

          {sections.map((section) => (
            <div key={section.category} className="flex flex-col gap-3">
              <SectionHeader title={t(section.titleKey)} />
              <div className="grid grid-cols-4 xl:grid-cols-5 gap-3">
                {section.items.map((item) => (
                  <ShopCard
                    key={item.id}
                    item={item}
                    points={afkPoints}
                    ownedCount={ownedCounts[item.id] ?? 0}
                    onClick={openCheckout}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {pending && (
        <CheckoutOverlay
          item={pending.item}
          purchaseId={pending.purchaseId}
          points={afkPoints}
          onComplete={load}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
