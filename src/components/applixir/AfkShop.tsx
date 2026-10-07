import { useEffect, useMemo, useState, useRef } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../store/useThemeStore";
import { Button } from "../ui/buttons/Button";
import { Modal } from "../ui/Modal";
import { useAnimationsEnabled } from "../../hooks/useEntranceAnimation";
import { getAfkShopCatalog, purchaseAfkShopItem } from "../../services/nrc-service";
import { log } from "../../utils/logging-utils";
import type { AfkShopCatalogResponse, AfkShopItemDto, AfkShopPurchaseResponse } from "../../types/afkpoints";

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

function shopAvailability(item: AfkShopItem, ownedCount: number) {
  const maxedHeld = item.kind === "held" && item.maxHeld !== undefined && ownedCount >= item.maxHeld;
  const ownedUnlock = item.kind === "unlock" && ownedCount > 0;
  return { maxedHeld, ownedUnlock, soldOut: maxedHeld || ownedUnlock };
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

  const { maxedHeld, ownedUnlock, soldOut } = shopAvailability(item, ownedCount);

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
      <button
        type="button"
        aria-label={item.name}
        aria-haspopup="dialog"
        disabled={soldOut}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => !soldOut && onClick(item)}
        className="relative w-full flex flex-col items-center justify-between aspect-square px-3 pt-3 pb-5 scroll-mb-4 transition-all duration-150 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
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
      </button>

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
  ownedCount,
  onClick,
}: {
  item: AfkShopItem;
  endsInDays: number;
  points: number;
  ownedCount: number;
  onClick: (item: AfkShopItem) => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const accentColor = useThemeStore((s) => s.accentColor);
  const colors = RARITY.LEGENDARY;
  const affordable = points >= item.price;
  const { maxedHeld, ownedUnlock, soldOut } = shopAvailability(item, ownedCount);
  const ownedLabel = ownedUnlock ? t("applixir.shop.owned") : maxedHeld ? `${ownedCount}/${item.maxHeld}` : null;

  return (
    <div className="relative pb-3 shrink-0">
      <button
        type="button"
        aria-label={item.name}
        aria-haspopup="dialog"
        disabled={soldOut}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => !soldOut && onClick(item)}
        className="relative w-full flex items-center gap-5 px-5 py-4 overflow-hidden transition-all duration-150 select-none text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
        style={{
          background: hovered && !soldOut
            ? `linear-gradient(115deg, ${colors.base}45 0%, rgba(8,8,10,0.75) 55%, ${colors.base}35 100%)`
            : `linear-gradient(115deg, ${colors.base}30 0%, rgba(8,8,10,0.8) 55%, ${colors.base}20 100%)`,
          border: `1px solid ${hovered && !soldOut ? accentColor.value : `${colors.base}80`}`,
          cursor: soldOut ? "default" : "pointer",
        }}
      >
        <Icon
          icon={item.icon}
          className="w-14 h-14 shrink-0 transition-transform duration-150"
          style={{
            color: colors.bright,
            filter: `drop-shadow(0 0 ${hovered ? 14 : 8}px ${colors.base})`,
            transform: hovered && !soldOut ? "scale(1.08)" : "scale(1)",
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
      </button>
      <div className="absolute bottom-0 right-8 pointer-events-none">
        <PricePill
          item={item}
          affordable={affordable}
          ownedLabel={ownedLabel}
        />
      </div>
    </div>
  );
}

type CheckoutPhase = "confirm" | "processing" | "success" | "error";

function isPurchaseReceipt(value: unknown, itemId: string): value is AfkShopPurchaseResponse {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<AfkShopPurchaseResponse>;
  // Rust returns a grant descriptor, not a boolean or an owned-item count.
  return receipt.itemId === itemId && Number.isSafeInteger(receipt.balance) &&
    typeof receipt.granted === "string" && receipt.granted.trim().length > 0;
}

function CheckoutOverlay({
  item,
  purchaseId,
  points,
  onConfirmed,
  onComplete,
  onClose,
}: {
  item: AfkShopItem;
  purchaseId: string;
  points: number;
  onConfirmed: (receipt: AfkShopPurchaseResponse) => void;
  onComplete: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const animationsEnabled = useAnimationsEnabled();
  const [phase, setPhase] = useState<CheckoutPhase>("confirm");
  const [receipt, setReceipt] = useState<AfkShopPurchaseResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const purchasePendingRef = useRef(false);
  const purchaseAttemptedRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const colors = RARITY[item.rarity];
  const affordable = points >= item.price;
  const locked = phase === "processing";

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const guardedDismiss = () => {
    // Protect the pre-rerender header, backdrop, Escape and Cancel callbacks too.
    if (!purchasePendingRef.current) onClose();
  };

  const refreshCatalog = async () => {
    if (refreshPendingRef.current || purchasePendingRef.current || !mountedRef.current) return;
    refreshPendingRef.current = true;
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      const refreshed = await onComplete();
      if (mountedRef.current) setRefreshFailed(!refreshed);
    } catch (e) {
      log("error", `[AfkShop] catalog refresh failed: ${JSON.stringify(e)}`);
      if (mountedRef.current) setRefreshFailed(true);
    } finally {
      refreshPendingRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  };

  const startPurchase = async () => {
    if (purchaseAttemptedRef.current || purchasePendingRef.current || !affordable || !mountedRef.current) return;
    // The API forwards purchaseId but does not promise server-side deduplication.
    // An unknown transport outcome therefore cannot expose a payment retry.
    purchaseAttemptedRef.current = true;
    purchasePendingRef.current = true;
    setPhase("processing");
    let confirmed: AfkShopPurchaseResponse;
    try {
      const result = await purchaseAfkShopItem(item.id, purchaseId);
      if (!isPurchaseReceipt(result, item.id)) throw new Error("Invalid AFK shop purchase receipt");
      confirmed = result;
    } catch (e) {
      log("error", `[AfkShop] purchase could not be confirmed: ${JSON.stringify(e)}`);
      if (mountedRef.current) setPhase("error");
      return;
    } finally {
      purchasePendingRef.current = false;
    }
    // Commit the actual receipt before the separate catalogue read. A failed
    // refresh must not turn an accepted purchase into a failed transaction.
    if (mountedRef.current) {
      setReceipt(confirmed);
      setPhase("success");
    }
    try {
      onConfirmed(confirmed);
    } catch (e) {
      log("error", `[AfkShop] balance notification failed: ${JSON.stringify(e)}`);
    }
    await refreshCatalog();
  };

  return (
    <Modal
      title={item.name}
      titleIcon={<Icon icon={item.icon} className="w-5 h-5" style={{ color: colors.bright }} />}
      width="sm"
      onClose={guardedDismiss}
      canClose={() => !purchasePendingRef.current}
      hideCloseButton={locked}
      closeOnEscape={!locked}
      closeOnClickOutside={!locked}
      contentClassName="bg-[#0a0a0c]"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {phase === "success" ? (
            <>
              {(refreshFailed || refreshing) && <Button variant="flat" size="sm" disabled={refreshing} onClick={refreshCatalog}>{t("applixir.shop.check_shop")}</Button>}
              <Button variant="flat" size="sm" onClick={guardedDismiss}>{t("common.close")}</Button>
            </>
          ) : phase === "error" ? (
            <>
              <Button variant="flat" size="sm" onClick={guardedDismiss}>{t("applixir.shop.cancel")}</Button>
              <Button variant="flat" size="sm" disabled={refreshing} onClick={refreshCatalog}>{t("applixir.shop.check_shop")}</Button>
            </>
          ) : (
            <>
              <Button variant="flat" size="sm" disabled={locked} onClick={guardedDismiss}>{t("applixir.shop.cancel")}</Button>
              <Button variant="flat" size="sm" disabled={locked || !affordable} aria-busy={locked} onClick={startPurchase}>
                {locked ? t("applixir.shop.processing") : affordable ? t("applixir.shop.buy") : t("applixir.shop.insufficient")}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div
        className="flex min-w-0 flex-col items-center gap-4 px-6 py-6 [overflow-wrap:anywhere]"
        style={{
          background: `linear-gradient(180deg, rgba(10,10,12,0.97) 0%, ${colors.base}30 100%)`,
          border: `1px solid ${phase === "success" ? "#4ade80" : phase === "error" ? "#ef4444" : colors.base}`,
          boxShadow: `0 0 40px rgba(0,0,0,0.8), 0 0 20px ${colors.base}40`,
        }}
      >
        {phase === "success" && receipt ? (
          <div role="status" className={`${animationsEnabled ? "animate-slide-up-fade-in " : ""}flex min-w-0 flex-col items-center gap-4 text-center`}>
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
                {t("applixir.window.balance", { balance: receipt.balance.toLocaleString() })}
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
            <div role="alert" className="flex min-w-0 flex-col items-center gap-2 text-center">
              <span className="font-smallcaps text-lg tracking-wide text-white text-shadow">{t("applixir.shop.checkout_unconfirmed")}</span>
              <span className="font-minecraft text-xs leading-relaxed text-white/70">{t("applixir.shop.checkout_unconfirmed_hint")}</span>
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
              <div role="status" className="flex items-center gap-2.5 min-h-9">
                <Icon icon="solar:refresh-bold" className={`w-5 h-5 shrink-0${animationsEnabled ? " animate-spin" : ""}`} style={{ color: colors.bright }} />
                <span className="font-minecraft text-[11px] text-white/60">
                  {t("applixir.shop.processing")}
                </span>
              </div>
            ) : null}
          </>
        )}
        {refreshing && <p role="status" className="font-minecraft text-xs text-white/70 text-center">{t("applixir.shop.loading")}</p>}
        {refreshFailed && <p role="alert" className="font-minecraft text-xs leading-relaxed text-white/80 text-center">{t(phase === "success" ? "applixir.shop.refresh_after_purchase_error" : "applixir.shop.load_error")}</p>}
      </div>
    </Modal>
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
        boxShadow: `0 0 15px ${accentColor.value}20 inset`,
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
                style={{ backgroundColor: accentColor.value, boxShadow: `0 0 8px ${accentColor.shadowValue}` }}
              />
            )}
            <Icon
              icon={cat.icon}
              className="w-4 h-4 shrink-0"
              style={{ color: isActive ? accentColor.value : "rgba(255,255,255,0.4)" }}
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

function StatusMessage({ icon, text, spin, onRetry }: { icon: string; text: string; spin?: boolean; onRetry?: () => Promise<void> }) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <Icon icon={icon} className={`w-10 h-10${spin ? " animate-spin" : ""}`} style={{ color: accentColor.value }} />
      <span className="font-minecraft text-xs text-white/60">{text}</span>
      {onRetry && <Button variant="flat" size="sm" onClick={onRetry}>{t("common.try_again")}</Button>}
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
  const retryPendingRef = useRef(false);
  const checkoutOpenRef = useRef(false);
  const loadVersionRef = useRef(0);

  const load = async () => {
    const version = ++loadVersionRef.current;
    try {
      const res = await getAfkShopCatalog();
      if (version !== loadVersionRef.current) return false;
      if (!res) {
        setFailed(true);
        return false;
      }
      setAfkPoints(res.afkPoints);
      setOwnedCounts(res.ownedCounts ?? {});
      setMapped(mapCatalog(res));
      setFailed(false);
      onBalanceChange?.(res.afkPoints);
      return true;
    } catch (e) {
      if (version === loadVersionRef.current) {
        log("error", `[AfkShop] catalog load failed: ${JSON.stringify(e)}`);
        setFailed(true);
      }
      return false;
    } finally {
      if (version === loadVersionRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return () => { loadVersionRef.current++; };
  }, []);

  // Manual catalogue recovery only; checkout's existing refresh contract stays separate.
  const retryLoad = async () => {
    if (retryPendingRef.current) return;
    retryPendingRef.current = true;
    setLoading(true);
    setFailed(false);
    try {
      await load();
    } finally {
      retryPendingRef.current = false;
    }
  };

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

  const openCheckout = (item: AfkShopItem) => {
    if (checkoutOpenRef.current) return;
    checkoutOpenRef.current = true;
    setPending({ item, purchaseId: crypto.randomUUID() });
  };

  let shopContent;
  if (loading) {
    shopContent = <StatusMessage icon="svg-spinners:ring-resize" text={t("applixir.shop.loading")} />;
  } else if (failed || !mapped) {
    shopContent = <StatusMessage icon="solar:danger-triangle-bold" text={t("applixir.shop.load_error")} onRetry={retryLoad} />;
  } else if (mapped.sections.length === 0 && !mapped.featured) {
    shopContent = <StatusMessage icon="solar:box-bold" text={t("applixir.shop.empty")} />;
  } else {
    shopContent = (
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
                ownedCount={ownedCounts[mapped.featured.id] ?? 0}
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
      </div>
    );
  }

  // Keep the same checkout consumer mounted across loading/error/empty views.
  return (
    <>
      {shopContent}
      {pending && (
        <CheckoutOverlay
          item={pending.item}
          purchaseId={pending.purchaseId}
          points={afkPoints}
          onConfirmed={(receipt) => {
            // A pre-purchase snapshot cannot overwrite the accepted balance.
            loadVersionRef.current++;
            setAfkPoints(receipt.balance);
            onBalanceChange?.(receipt.balance);
          }}
          onComplete={load}
          onClose={() => {
            checkoutOpenRef.current = false;
            setPending(null);
          }}
        />
      )}
    </>
  );
}
