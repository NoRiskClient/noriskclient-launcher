"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SkinRenderer } from '@noriskclient/nrc-skin-renderer/react';
import type { PromoOutlineConfig } from '@noriskclient/nrc-skin-renderer/postfx';
import type { SnapshotCosmetic } from '@noriskclient/nrc-skin-renderer/snapshot';

import { SkinViewer } from './SkinViewer';
import { useActiveSkinTexture } from '../../hooks/useActiveSkinTexture';
import { useEquippedCosmetics } from '../../hooks/useEquippedCosmetics';
import { useIdleEmote } from '../../hooks/useIdleEmote';
import { useSelectedIcon } from '../../hooks/useSelectedIcon';
import { useSkinPreview } from '../../hooks/useSkinPreview';
import { useWindowFocus } from '../../hooks/useWindowFocus';
import { useMinecraftAuthStore } from '../../store/minecraft-auth-store';
import { useQualitySettingsStore } from '../../store/quality-settings-store';
import { useThemeStore } from '../../store/useThemeStore';

const NO_ACCOUNT_SKIN_URL = "/skins/steve.png";
const RIG_SHADOW = 'drop-shadow(5px 10px 5px rgba(0,0,0,0.75))';
const NO_COSMETICS: SnapshotCosmetic[] = [];

export const PLAYER_RIG_WIDTH = 225;
export const PLAYER_RIG_HEIGHT = 450;

const CANVAS_WIDTH = 1040;
const CANVAS_HEIGHT = 860;

const canvasStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: `${CANVAS_WIDTH}px`,
  height: `${CANVAS_HEIGHT}px`,
  maxWidth: "none",
  pointerEvents: "none",
  filter: RIG_SHADOW,
};

interface PlayerRigProps {
  playerName: string | null | undefined;
  outline?: Partial<PromoOutlineConfig>;
}

function useMinLoading(active: boolean, minMs: number): boolean {
  const [done, setDone] = useState(!active);
  const startRef = useRef(Date.now());
  useEffect(() => {
    if (active) {
      startRef.current = Date.now();
      setDone(false);
      return;
    }
    if (done) return;
    const remaining = Math.max(0, minMs - (Date.now() - startRef.current));
    const id = setTimeout(() => setDone(true), remaining);
    return () => clearTimeout(id);
  }, [active, minMs, done]);
  return active || !done;
}

export function PlayerRig({ playerName, outline }: PlayerRigProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const activeAccount = useMinecraftAuthStore((state) => state.activeAccount);
  const { textureUrl, variant, loading: skinLoading } = useActiveSkinTexture();
  const { cosmetics: equippedCosmetics, loading: cosmeticsLoading } =
    useEquippedCosmetics(activeAccount?.id);
  const selectedIcon = useSelectedIcon(activeAccount?.id);
  const idleEmote = useIdleEmote();
  const animated = useQualitySettingsStore((s) => s.cosmeticRenderer3d);
  const isWindowFocused = useWindowFocus();
  const hasAccount = !!activeAccount;
  const loading = useMinLoading(
    hasAccount && (skinLoading || cosmeticsLoading),
    450,
  );

  const equipped = useMemo(
    () =>
      equippedCosmetics.map((c) => ({
        id: c.cosmeticId,
        type: c.type,
        urls: c.urls,
      })),
    [equippedCosmetics],
  );
  const ownNametag = useMemo(
    () =>
      playerName
        ? {
            text: playerName.toString(),
            iconUrl: selectedIcon.url,
            iconPlus: selectedIcon.plus,
          }
        : null,
    [playerName, selectedIcon.url, selectedIcon.plus],
  );

  const rigTextureUrl = hasAccount ? textureUrl : NO_ACCOUNT_SKIN_URL;
  const rigVariant = hasAccount ? variant : "slim";
  const rigCosmetics = hasAccount ? equipped : NO_COSMETICS;
  const rigNametag = hasAccount
    ? ownNametag
    : { text: t('auth.noAccountNametag') };

  const { url: stillUrl } = useSkinPreview(!animated && !loading, {
    textureUrl: rigTextureUrl,
    variant: rigVariant,
    cosmetics: rigCosmetics,
    nametag: rigNametag,
    fit: false,
    crop: false,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    dpr: 1.5,
    fallbackUrl: null,
  });

  return (
    <div
      className="relative flex-shrink-0"
      style={{
        width: `${PLAYER_RIG_WIDTH}px`,
        height: `${PLAYER_RIG_HEIGHT}px`,
      }}
    >
      {animated ? (
        <SkinRenderer
          textureUrl={rigTextureUrl}
          variant={rigVariant}
          cosmetics={rigCosmetics}
          emote={idleEmote.urls}
          emoteLoop={idleEmote.loop}
          onEmoteEnd={idleEmote.onEnd}
          dragAxis="yaw"
          outline={outline}
          nametag={rigNametag}
          loading={loading}
          paused={!isWindowFocused}
          fps={60}
          maxDpr={1.5}
          skeletonColor={accentColor.value}
          className="bg-transparent"
          style={canvasStyle}
        />
      ) : stillUrl ? (
        <SkinViewer
          skinUrl={stillUrl}
          playerName={playerName?.toString()}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="bg-transparent"
          style={canvasStyle}
        />
      ) : null}
    </div>
  );
}
