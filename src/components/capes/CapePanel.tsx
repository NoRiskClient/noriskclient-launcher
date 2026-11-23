import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { CapeSelection } from "./CapeList";
import { NO_CAPE_ID } from "./noCape";
import { PlayerPreview3D } from "../launcher/PlayerPreview3D";
import { AccentButton } from "../ui/AccentButton";
import { useActiveSkinTexture } from "../../hooks/useActiveSkinTexture";
import { useCapeFavoritesStore } from "../../store/useCapeFavoritesStore";

interface CapePanelProps {
  selection: CapeSelection | null;
  equippedCapeId: string | null;
  busy: boolean;
  canFavorite: boolean;
  onEquip: (capeId: string) => void;
}

export function CapePanel({ selection, equippedCapeId, busy, canFavorite, onEquip }: CapePanelProps) {
  const { t } = useTranslation();
  const skin = useActiveSkinTexture();
  const capeId = selection?.capeId ?? null;
  const isFavorite = useCapeFavoritesStore((state) => !!capeId && state.favoriteCapeIds.includes(capeId));
  const toggleFavorite = useCapeFavoritesStore((state) => state.toggleFavoriteOptimistic);

  const isNoCape = capeId === NO_CAPE_ID;
  const isEquipped = !!capeId && capeId === equippedCapeId;
  const favoriteLabel = isFavorite ? t("capes.unfavorite") : t("capes.favorite");

  return (
    <>
      <PlayerPreview3D
        skinUrl={skin.loading ? null : skin.textureUrl}
        variant={skin.variant}
        capeUrl={selection?.capeUrl ?? null}
        facing="back"
      />
      <div className="flex gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <AccentButton disabled={!selection || busy || isEquipped} onClick={() => selection && onEquip(selection.capeId)}>
            {isEquipped ? t("capes.equipped") : isNoCape ? t("capes.unequipCape") : t("capes.equipCape")}
          </AccentButton>
        </div>
        {canFavorite && (
          <button
            type="button"
            disabled={!selection || isNoCape}
            onClick={() => selection && void toggleFavorite(selection.capeId)}
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg border-2 border-white/10 hover:border-white/25 bg-black/30 text-white/70 hover:text-white transition-colors disabled:opacity-40 disabled:hover:border-white/10"
            title={favoriteLabel}
            aria-label={favoriteLabel}
          >
            <Icon
              icon={isFavorite ? "ph:heart-fill" : "ph:heart"}
              className="w-4 h-4"
              style={{ color: isFavorite ? "#ef4444" : undefined }}
            />
          </button>
        )}
      </div>
    </>
  );
}
