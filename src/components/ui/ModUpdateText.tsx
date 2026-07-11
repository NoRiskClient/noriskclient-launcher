"use client";

import React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { UnifiedVersion } from "../../types/unified";

interface ModUpdateTextProps {
  isFromModPack: boolean;
  updateVersion: UnifiedVersion;
  currentVersion?: string;
  className?: string;
  modpackOrigin?: string | null;
  updatesEnabled?: boolean | null;
}

/**
 * Component for displaying formatted update text based on modpack origin
 * Provides clear, readable information about update checks and modpack relationships
 */
export function ModUpdateText({
  isFromModPack,
  updateVersion,
  currentVersion,
  className = "",
  modpackOrigin,
  updatesEnabled
}: ModUpdateTextProps) {
  const { t } = useTranslation();
  const isPlatformPack = modpackOrigin?.startsWith('modrinth:') || modpackOrigin?.startsWith('curseforge:');

  const versionTarget = (
    <>
      {t('content.update.update_to_version')}{" "}
      <span className="text-white font-medium">{updateVersion.version_number}</span>
      {currentVersion && (
        <span className="text-gray-500">
          {" "}{t('content.update.from_version', { version: currentVersion })}
        </span>
      )}
    </>
  );

  // Handle different cases based on modpack origin and update settings
  if (isFromModPack && updatesEnabled !== true) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="flex items-center gap-2">
          <Icon
            icon="solar:box-bold-duotone"
            className="w-4 h-4 text-purple-400 flex-shrink-0"
          />
          <span className="text-sm font-semibold text-purple-300">
            {isPlatformPack
              ? t('content.update.modpack_mod')
              : t('content.update.managed_mod')}
          </span>
        </div>

        <div className="space-y-1 text-xs text-gray-300">
          <div className="flex items-start gap-2">
            <Icon
              icon="solar:shield-warning-bold-duotone"
              className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5"
            />
            <div>
              <p className="font-medium text-yellow-300">
                {t('content.update.checks_disabled_title')}
              </p>
              <p className="text-gray-400 leading-relaxed">
                {isPlatformPack
                  ? t('content.update.disabled_modpack_desc')
                  : t('content.update.disabled_managed_desc')}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Icon
              icon="solar:refresh-bold-duotone"
              className="w-3 h-3 text-blue-400 flex-shrink-0 mt-0.5"
            />
            <div>
              <p className="font-medium text-blue-300">
                {t('content.update.manual_available_title')}
              </p>
              <p className="text-gray-400 leading-relaxed">
                {t('content.update.manual_available_desc')}{" "}
                {versionTarget}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  } else if (!isFromModPack && updatesEnabled === false) {
    // Regular mod with updates explicitly disabled
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="flex items-center gap-2">
          <Icon
            icon="solar:download-minimalistic-bold"
            className="w-4 h-4 text-gray-400 flex-shrink-0"
          />
          <span className="text-sm font-semibold text-gray-300">
            {t('content.update.available')}
          </span>
        </div>

        <div className="space-y-1 text-xs text-gray-300">
          <div className="flex items-start gap-2">
            <Icon
              icon="solar:shield-warning-bold-duotone"
              className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5"
            />
            <div>
              <p className="font-medium text-yellow-300">
                {t('content.update.checks_disabled_short_title')}
              </p>
              <p className="text-gray-400 leading-relaxed">
                {t('content.update.disabled_regular_desc', { version: updateVersion.version_number })}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon
          icon="solar:download-minimalistic-bold"
          className="w-4 h-4 text-green-400 flex-shrink-0"
        />
        <span className="text-sm font-semibold text-green-300">
          {t('content.update.available')}
        </span>
      </div>

      <div className="space-y-1 text-xs text-gray-300">
        <div className="flex items-start gap-2">
          <Icon
            icon="solar:refresh-circle-bold-duotone"
            className="w-3 h-3 text-green-400 flex-shrink-0 mt-0.5"
          />
          <div>
            <p className="font-medium text-green-300">
              {t('content.update.ready_title')}
            </p>
              <p className="text-gray-400 leading-relaxed">
                {t('content.update.ready_desc')}{" "}
                {versionTarget}
              </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for getting formatted update text
 */
export function useModUpdateText() {
  const getUpdateText = (
    isFromModPack: boolean,
    updateVersion: UnifiedVersion,
    currentVersion?: string,
    modpackOrigin?: string | null,
    updatesEnabled?: boolean | null
  ): string => {
    // Handle different cases based on modpack origin and update settings

    if (isFromModPack && updatesEnabled !== true) {
      // Modpack mod with updates disabled
      const isModPack = modpackOrigin?.startsWith('modrinth:') || modpackOrigin?.startsWith('curseforge:');
      const modType = isModPack ? 'ModPack Mod' : 'Managed Mod';
      const reason = isModPack ? 'breaking changes' : 'conflicts';
      return `${modType}: Update checks disabled to prevent ${reason}. Manual update to ${updateVersion.version_number} available.`;
    } else if (!isFromModPack && updatesEnabled === false) {
      // Regular mod with updates explicitly disabled
      return `Update available (${updateVersion.version_number}) but update checks are disabled. Enable update checks to allow automatic updates.`;
    } else {
      // Normal case: updates enabled or modpack override
      return `Update to ${updateVersion.version_number}${currentVersion ? ` from ${currentVersion}` : ''}`;
    }
  };

  const getShortUpdateText = (
    isFromModPack: boolean,
    updateVersion: UnifiedVersion,
    modpackOrigin?: string | null,
    updatesEnabled?: boolean | null
  ): string => {
    // Handle different cases based on modpack origin and update settings

    if (isFromModPack && updatesEnabled !== true) {
      // Modpack mod with updates disabled
      const isModPack = modpackOrigin?.startsWith('modrinth:') || modpackOrigin?.startsWith('curseforge:');
      const modType = isModPack ? 'ModPack Mod' : 'Managed Mod';
      return `${modType}: Manual update to ${updateVersion.version_number}`;
    } else if (!isFromModPack && updatesEnabled === false) {
      // Regular mod with updates explicitly disabled
      return `Update available (${updateVersion.version_number}) - disabled`;
    } else {
      // Normal case: updates enabled or modpack override
      return `Update to ${updateVersion.version_number}`;
    }
  };

  return {
    getUpdateText,
    getShortUpdateText
  };
}
