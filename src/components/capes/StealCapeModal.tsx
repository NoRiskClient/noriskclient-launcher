import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import { Modal } from "../ui/Modal";
import { getEquippedCosmetics } from "../../services/cosmetic-equip-service";
import { getCapesByHashes, getPlayerProfileByUuidOrName } from "../../services/cape-service";
import type { CosmeticCape } from "../../types/noriskCapes";
import { toast } from "react-hot-toast";

import { Cape3DPreviewWithToggle } from "./CapeList";
import { getCapeImageUrl } from "../../services/cape-service";
import { MinecraftSkinService } from "../../services/minecraft-skin-service";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";

interface StealCapeModalProps {
  onCancel: () => void;
  onEquipCape: (capeId: string) => void;
  isExperimental: boolean;
}

export function StealCapeModal({ onCancel, onEquipCape, isExperimental }: StealCapeModalProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Preview state
  const [previewCape, setPreviewCape] = useState<CosmeticCape | null>(null);
  const [previewSkinUrl, setPreviewSkinUrl] = useState<string | undefined>(undefined);
  const { activeAccount } = useMinecraftAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      // 1. Resolve user profile
      const profile = await getPlayerProfileByUuidOrName(username.trim());
      if (!profile || !profile.id) {
        setError(t('capes.stealCapeNotFound', 'Player not found.'));
        return;
      }

      // 2. Get equipped cosmetics
      const equippedDto = await getEquippedCosmetics(profile.id);
      if (equippedDto.customCapeHash) {
        const fetchedCapes = await getCapesByHashes([equippedDto.customCapeHash]);
        if (fetchedCapes && fetchedCapes.length > 0) {
          // Fetch active user's skin for the preview
          let userSkinUrl: string | undefined;
          if (activeAccount?.id) {
            try {
              const active = await MinecraftSkinService.getActiveSkin();
              if (active?.base64_data) {
                userSkinUrl = `data:image/png;base64,${active.base64_data}`;
              }
            } catch (e) {
              console.error("Failed to load active skin for steal preview:", e);
            }
          }
          
          setPreviewSkinUrl(userSkinUrl);
          setPreviewCape(fetchedCapes[0]);
          toast.success(t('capes.stealCapeSuccess', 'Cape found! Select it to equip.'));
        } else {
          setError(t('capes.stealCapeNotFound'));
        }
      } else {
        setError(t('capes.stealCapeNoCapeEquipped'));
      }
    } catch (err: any) {
      console.error("Failed to steal cape:", err);
      setError(t('capes.stealCapeError'));
    } finally {
      setIsLoading(false);
    }
  };

  if (previewCape) {
    const capeId = previewCape._id;
    const capeUrl = getCapeImageUrl(capeId, isExperimental);
    return (
      <Modal
        title={t('capes.capePreview')}
        onClose={onCancel}
        width="md"
        variant="flat"
      >
        <Cape3DPreviewWithToggle
          skinUrl={previewSkinUrl}
          capeUrl={capeUrl}
          capeId={capeId}
          isEquipped={false}
          isExperimental={isExperimental}
          onEquipCape={() => {
            onEquipCape(capeId);
            onCancel(); // Close modal after equipping
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal
      title={t('capes.stealCape')}
      onClose={onCancel}
      width="sm"
      variant="flat"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
        <p className="text-white/80 font-minecraft text-sm">
          {t('capes.stealCapeDescription', 'Enter the username of the player you want to steal the cape from.')}
        </p>

        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('capes.usernamePlaceholder', 'Username')}
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-white font-minecraft focus:outline-none focus:border-white transition-colors"
            autoFocus
          />
          {error && <span className="text-red-400 text-xs font-minecraft">{error}</span>}
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button
            type="button"
            variant="flat-secondary"
            onClick={onCancel}
            disabled={isLoading}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="flat"
            disabled={!username.trim() || isLoading}
            className="bg-white/10 text-white hover:bg-white/20 border-white/10"
          >

            {t('common.confirm', 'Confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
