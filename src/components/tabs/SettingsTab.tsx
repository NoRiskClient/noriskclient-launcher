"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { Button } from ".././ui/buttons/Button";
import type { LauncherConfig } from "../../types/launcherConfig";
import * as ConfigService from "../../services/launcher-config-service";
import { useThemeStore } from "../../store/useThemeStore";
import { useSettingsModalStore } from "../../store/settings-modal-store";
import { cn } from "../../lib/utils";
import { toast } from "react-hot-toast";
import { ActionButton } from ".././ui/ActionButton";
import { Modal } from ".././ui/Modal";
import { SearchWithFilters } from ".././ui/SearchWithFilters";
import { SettingsSearchContext } from ".././ui/settings/SettingsSearchContext";
import { openLauncherDirectory } from "../../services/tauri-service";
import { DebugSection, getDebugTabs } from "./DebugSection";
import { GeneralTab } from "./settings/GeneralTab";
import { AppearanceTab } from "./settings/AppearanceTab";
import { AdvancedTab } from "./settings/AdvancedTab";
import { ClipsTab } from "./settings/ClipsTab";
import { SettingsConfigProvider } from "./settings/settings-context";
import { useTranslation } from "react-i18next";
import { setDiscordState } from "../../utils/discordRpc";
import { parseErrorMessage } from "../../utils/error-utils";
import { useClipSettingsSync } from "../../hooks/useClipSettingsSync";
import { isMacOS, supportsClips } from "../../utils/platform";
import { isApplixirEnabled } from "../../services/flagsmith-service";

type SettingsTabId = "general" | "appearance" | "clips" | "advanced" | "debug";

const SETTINGS_TAB_IDS: SettingsTabId[] = [
  "general",
  "appearance",
  "clips",
  "advanced",
  "debug",
];

interface SettingsTabProps {
  onClose: () => void;
}

type SettingsSectionDefinition = { id: string; label: string };

function getOwnedSettingsSections(root: HTMLElement, defs: SettingsSectionDefinition[]): HTMLElement[] {
  const ids = new Set(defs.map(({ id }) => `settings-section-${id}`));
  return Array.from(root.querySelectorAll<HTMLElement>('section[id^="settings-section-"]'))
    .filter(section => ids.has(section.id));
}

function readActiveSettingsSection(root: HTMLElement, sections: HTMLElement[]): string | null {
  if (!sections.length) return null;
  // A short final section cannot always align with the upper scrollspy line.
  const atEnd = root.scrollHeight > root.clientHeight + 1 &&
    root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
  const rootTop = root.getBoundingClientRect().top;
  let current: HTMLElement | null = atEnd ? sections[sections.length - 1] : null;
  if (!atEnd) {
    for (const section of sections) {
      if (section.getBoundingClientRect().top - rootTop <= 80) current = section;
    }
  }
  return current ? current.id.slice("settings-section-".length) : null;
}

function scrollOwnedSettingsElement(root: HTMLElement | null, element: Element, block: "nearest" | "start", behavior: ScrollBehavior = "auto") {
  if (!root || !root.contains(element)) return;
  const rootRect = root.getBoundingClientRect();
  if (root.clientHeight <= 0 || rootRect.height <= 0) return;
  // Rects share the launcher's entrance transform; scroll offsets are local CSS pixels.
  const scaleY = root.offsetHeight > 0 ? rootRect.height / root.offsetHeight : 1;
  const style = getComputedStyle(element);
  const rootStyle = getComputedStyle(root);
  const paddingTop = parseFloat(rootStyle.scrollPaddingTop) || 0;
  const paddingBottom = parseFloat(rootStyle.scrollPaddingBottom) || 0;
  const rect = element.getBoundingClientRect();
  const top = root.scrollTop + (rect.top - rootRect.top) / scaleY - root.clientTop -
    (parseFloat(style.scrollMarginTop) || 0);
  const bottom = root.scrollTop + (rect.bottom - rootRect.top) / scaleY - root.clientTop +
    (parseFloat(style.scrollMarginBottom) || 0);
  let next = top - paddingTop;
  if (block === "nearest") {
    const viewTop = root.scrollTop + paddingTop;
    const viewBottom = root.scrollTop + root.clientHeight - paddingBottom;
    if (top >= viewTop && bottom <= viewBottom || top <= viewTop && bottom >= viewBottom) return;
    const fits = bottom - top <= viewBottom - viewTop;
    next = top < viewTop
      ? fits ? top - paddingTop : bottom - root.clientHeight + paddingBottom
      : fits ? bottom - root.clientHeight + paddingBottom : top - paddingTop;
  }
  root.scrollTo({
    top: Math.max(0, Math.min(Math.max(0, root.scrollHeight - root.clientHeight), next)),
    left: root.scrollLeft,
    behavior,
  });
}

export function SettingsTab({ onClose }: SettingsTabProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<LauncherConfig | null>(null);
  const [tempConfig, setTempConfig] = useState<LauncherConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  useClipSettingsSync(config, saving);
  const requested = useSettingsModalStore.getState().tab;
  const [activeTab, setActiveTab] = useState<SettingsTabId>(() =>
    SETTINGS_TAB_IDS.includes(requested as SettingsTabId)
      ? (requested as SettingsTabId)
      : "general",
  );

  const onlyTab = useSettingsModalStore.getState().only
    ? (SETTINGS_TAB_IDS.includes(requested as SettingsTabId)
        ? (requested as SettingsTabId)
        : null)
    : null;

  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(sidebarSearch), 150);
    return () => clearTimeout(id);
  }, [sidebarSearch]);
  const sidebarQuery = debouncedSearch.trim().toLowerCase();
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarListRef = useRef<HTMLDivElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const spySuppressRef = useRef(false);
  const spyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spyProbeRef = useRef<(() => void) | null>(null);
  const cancelSpySuppression = useCallback(() => {
    if (spyTimeoutRef.current !== null) clearTimeout(spyTimeoutRef.current);
    spyTimeoutRef.current = null;
    spySuppressRef.current = false;
  }, []);
  const [adsEnabled, setAdsEnabled] = useState(false);
  const rendersAdvanced = Boolean(config && tempConfig && !loading && !error) &&
    (activeTab === "advanced" || Boolean(sidebarQuery && !onlyTab));
  useEffect(() => {
    if (!rendersAdvanced) return;
    let alive = true;
    isApplixirEnabled()
      .then(enabled => { if (alive) setAdsEnabled(enabled); })
      .catch(() => { if (alive) setAdsEnabled(false); });
    return () => { alive = false; };
  }, [rendersAdvanced]);
  const [searchHasResults, setSearchHasResults] = useState(true);
  useEffect(() => {
    const node = contentRef.current;
    if (!sidebarQuery || !node || loading || error) { setSearchHasResults(true); return; }
    const check = () => setSearchHasResults(!!node.querySelector('section[id^="settings-section-"]'));
    check();
    const observer = new MutationObserver(check); observer.observe(node, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [sidebarQuery, loading, error]);

  useEffect(() => { setDiscordState("Configuring Settings"); }, []);

  useEffect(() => {
    cancelSpySuppression();
    setActiveSection(null);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab, sidebarQuery, cancelSpySuppression]);

  useEffect(() => cancelSpySuppression, [cancelSpySuppression]);


  const sectionDefs = useMemo<Record<SettingsTabId, SettingsSectionDefinition[]>>(() => ({
    general: [
      { id: "language", label: t("settings.language") },
      { id: "accent", label: t("settings.accent_color.title") },
      { id: "behaviour", label: t("settings.sections.behaviour") },
      { id: "interface", label: t("settings.sections.interface") },
    ],
    appearance: [
      { id: "theme", label: t("settings.theme.title") },
      { id: "font", label: t("settings.font.title") },
      { id: "background", label: t("settings.background.title") },
      { id: "custom-background", label: t("settings.custom_background.title") },
    ],
    clips: supportsClips()
      ? [
          ...(isMacOS() ? [{ id: "clips-permissions", label: t("settings.clips.permissions.title") }] : []),
          { id: "clips-general", label: t("settings.clips.title") },
          { id: "clips-hotkeys", label: t("settings.clips.hotkeys.title") },
          { id: "clips-buffer", label: t("settings.clips.buffer.title") },
          { id: "clips-quality", label: t("settings.clips.quality.title") },
          { id: "clips-audio", label: t("settings.clips.audio.title") },
          { id: "clips-storage", label: t("settings.clips.storage.title") },
          { id: "clips-library", label: t("settings.clips.library.title") },
        ]
      : [],
    advanced: [
      ...(adsEnabled ? [{ id: "ads", label: t("settings.sections.ads") }] : []),
      { id: "login_cache", label: t("settings.sections.login_cache") },
      { id: "gamedir", label: t("settings.game_data_dir.title") },
      { id: "hooks", label: t("settings.hooks.title") },
      { id: "licenses", label: t("settings.licenses.title") },
    ],
    debug: [{ id: "log-level", label: t("debug.log_level.title") }, ...getDebugTabs(t)],
  }), [t, adsEnabled]);

  const allTabs: {
    id: SettingsTabId;
    label: string;
    icon: string;
    children?: { id: string; label: string }[];
  }[] = [
    { id: "general", label: t("settings.tabs.general"), icon: "solar:settings-bold", children: sectionDefs.general },
    { id: "appearance", label: t("settings.tabs.appearance"), icon: "solar:palette-bold", children: sectionDefs.appearance },
    ...(supportsClips()
      ? [{ id: "clips" as const, label: t("settings.tabs.clips"), icon: "solar:videocamera-record-bold", children: sectionDefs.clips }]
      : []),
    { id: "advanced", label: t("settings.tabs.advanced"), icon: "solar:tuning-bold", children: sectionDefs.advanced },
    { id: "debug", label: t("settings.tabs.debug"), icon: "solar:bug-bold", children: sectionDefs.debug },
  ];

  const tabConfig = onlyTab ? allTabs.filter((tab) => tab.id === onlyTab) : allTabs;

  const selectTab = (id: SettingsTabId) => {
    cancelSpySuppression();
    setActiveSection(null);
    setSidebarSearch("");
    setActiveTab(id);
  };

  useEffect(() => {
    if (!activeSection) return;
    const root = sidebarListRef.current;
    const el = root?.querySelector(`[data-section-id="${activeSection}"]`);
    if (root && el) scrollOwnedSettingsElement(root, el, "nearest");
  }, [activeSection]);

  const scrollToSection = (id: string) => {
    const root = contentRef.current;
    const el = root && getOwnedSettingsSections(root, sectionDefs[activeTab])
      .find(section => section.id === `settings-section-${id}`);
    if (!el) return;
    cancelSpySuppression();
    spySuppressRef.current = true;
    setActiveSection(id);
    spyTimeoutRef.current = setTimeout(() => {
      spyTimeoutRef.current = null;
      spySuppressRef.current = false;
      spyProbeRef.current?.();
    }, 500);
    scrollOwnedSettingsElement(root, el, "start", "smooth");
  };

  useEffect(() => {
    const root = contentRef.current;
    const defs = sectionDefs[activeTab];
    if (sidebarQuery || loading || error || !config || !tempConfig || !root || !defs.length) {
      setActiveSection(null);
      return;
    }
    let alive = true;
    let sections: HTMLElement[] = [];
    const probe = () => {
      if (!alive || spySuppressRef.current) return;
      setActiveSection(readActiveSettingsSection(root, sections));
    };
    const resizeObserver = new ResizeObserver(probe);
    const refreshSections = () => {
      if (!alive) return;
      sections = getOwnedSettingsSections(root, defs);
      resizeObserver.disconnect();
      resizeObserver.observe(root);
      sections.forEach(section => resizeObserver.observe(section));
      probe();
    };
    spyProbeRef.current = probe;
    refreshSections();
    const mutationObserver = new MutationObserver(refreshSections);
    mutationObserver.observe(root, { childList: true, subtree: true });
    root.addEventListener("scroll", probe, { passive: true });
    return () => {
      alive = false;
      root.removeEventListener("scroll", probe);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (spyProbeRef.current === probe) spyProbeRef.current = null;
    };
  }, [activeTab, sidebarQuery, config, tempConfig, loading, error, sectionDefs]);

  const isResettingRef = useRef<boolean>(false);
  const { accentColor } = useThemeStore();

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null); try {
      const loadedConfig = await ConfigService.getLauncherConfig();
      const configWithHooks = {
        ...loadedConfig,
        hooks: loadedConfig.hooks || {
          pre_launch: null,
          wrapper: null,
          post_exit: null,
        },
      };
      setConfig(configWithHooks);
      setTempConfig({ ...configWithHooks });
    } catch (err) {
      console.error("Failed to load launcher config:", err);
      setError(parseErrorMessage(err));
      setConfig(null);
      setTempConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const autoSaveConfig = useCallback(async (configToSave: LauncherConfig) => {
    if (isResettingRef.current) {
      return;
    }

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const updatedConfig =
          await ConfigService.setLauncherConfig(configToSave);
        setConfig(updatedConfig);
        toast.success(t("settings.toast.auto_saved"), {
          duration: 2000,
          position: "bottom-right",
        });
      } catch (err) {
        console.error("Failed to auto-save configuration:", err);
        const errorMessage = parseErrorMessage(err);
        toast.error(t("settings.toast.auto_save_failed", { error: errorMessage }));
      } finally {
        setSaving(false);
      }
    }, 500);
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (
      tempConfig &&
      config &&
      JSON.stringify(config) !== JSON.stringify(tempConfig)
    ) {
      autoSaveConfig(tempConfig);
    }
  }, [tempConfig, config, autoSaveConfig]);

  const renderTabContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Icon
              icon="svg-spinners:ring-resize"
              className="w-10 h-10 text-white/70 mx-auto mb-4"
            />
            <p className="text-base text-white/70 font-smallcaps">
              {t("settings.loading")}
            </p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-red-900/30 border-2 border-red-700/50 rounded-lg p-6 my-4">
          <div className="flex items-start gap-3">
            <Icon
              icon="solar:danger-triangle-bold"
              className="w-8 h-8 text-red-400 flex-shrink-0 mt-1"
            />
            <div>
              <h3 className="text-base text-red-300 font-smallcaps mb-2">
                {t("settings.error.title")}
              </h3>
              <p className="text-sm text-red-200/80 font-smallcaps mb-4">
                {error}
              </p>
              <Button
                onClick={loadConfig}
                variant="secondary"
                size="sm"
                icon={<Icon icon="solar:refresh-bold" className="w-5 h-5" />}
              >
                {t("common.try_again")}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    if (!config || !tempConfig) {
      return (
        <div className="text-center p-8">
          <p className="text-base text-white/70 font-smallcaps">
            {t("settings.error.no_config")}
          </p>
        </div>
      );
    }

    const bodyOf: Partial<Record<SettingsTabId, ReactNode>> = {
      general: <GeneralTab />,
      appearance: <AppearanceTab />,
      clips: <ClipsTab />,
      advanced: <AdvancedTab adsEnabled={adsEnabled} />,
    };

    if (sidebarQuery && !onlyTab) {
      const order: SettingsTabId[] = ["general", "appearance", "advanced"];
      const ordered = [activeTab, ...order.filter((id) => id !== activeTab)].filter(
        (id) => bodyOf[id],
      ) as SettingsTabId[];
      return (
        <div className="space-y-6">
          {ordered.map((id) => (
            <Fragment key={id}>{bodyOf[id]}</Fragment>
          ))}
        </div>
      );
    }

    if (activeTab === "debug") return <DebugSection />;
    return bodyOf[activeTab] ?? null;
  };

  return (
    <Modal
      title={onlyTab ? tabConfig[0]?.label ?? t("nav.settings") : t("nav.settings")}
      titleIcon={
        <Icon
          icon={onlyTab ? tabConfig[0]?.icon ?? "solar:settings-bold" : "solar:settings-bold"}
          className="w-8 h-8"
        />
      }
      onClose={onClose}
      width="xl"
      className="nrc-settings-panel !max-w-6xl h-[85vh] flex flex-col"
      headerActions={
        <ActionButton
          id="open-directory"
          label={t("settings.open_directory")}
          icon="solar:folder-bold"
          variant="highlight"
          tooltip={t("settings.open_directory.tooltip")}
          size="sm"
          onClick={async () => {
            try {
              await openLauncherDirectory();
            } catch (err) {
              console.error("Failed to open launcher directory:", err);
              toast.error(t("settings.open_directory.error", { error: parseErrorMessage(err) }));
            }
          }}
        />
      }
    >
      <div className="flex h-full p-4 gap-2">
        <div className="w-64 flex flex-col flex-shrink-0">
          <div className="px-1 pb-3">
            <SearchWithFilters
              placeholder={t("common.search")}
              searchValue={sidebarSearch}
              onSearchChange={setSidebarSearch}
              showSort={false}
              showFilter={false}
              compact
              className="w-full"
            />
          </div>
          <div ref={sidebarListRef} className="space-y-0 flex-1 overflow-y-auto custom-scrollbar">
            {tabConfig.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <div key={tab.id}>
                  <button
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-lg transition-colors border-0 outline-none flex items-center gap-3",
                      "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70",
                      isActive
                        ? "text-white"
                        : "bg-transparent text-white/60 hover:bg-white/5 hover:text-white/90",
                    )}
                    style={isActive ? { backgroundColor: `${accentColor.value}26` } : undefined}
                    onClick={() => selectTab(tab.id)}
                  >
                    <Icon
                      icon={tab.icon}
                      className="w-6 h-6 transition-colors duration-200"
                      style={{ color: isActive ? accentColor.value : undefined }}
                    />
                    <span
                      className={cn(
                        "font-smallcaps text-lg transition-colors duration-200",
                        isActive && "font-medium",
                      )}
                    >
                      {tab.label}
                    </span>
                  </button>

                  {isActive && !sidebarQuery && tab.children && (
                    <div className="flex flex-col mt-1 ml-5 border-l border-white/10">
                      {tab.children.map((child) => {
                        const childActive = activeSection === child.id;
                        return (
                          <button
                            type="button"
                            aria-current={childActive ? "location" : undefined}
                            key={child.id}
                            data-section-id={child.id}
                            className={cn(
                              "w-full text-left pl-4 pr-2 py-1.5 -ml-px border-l-2 outline-none font-smallcaps text-base transition-[color,border-color] duration-150",
                              "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70",
                              childActive
                                ? "text-white"
                                : "border-transparent text-white/40 hover:text-white/75",
                            )}
                            style={childActive ? { borderColor: accentColor.value } : undefined}
                            onClick={() => scrollToSection(child.id)}
                          >
                            {child.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center">
          <div className="border-l border-white/10 mx-4 my-3 h-[85%]"></div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div
            ref={contentRef}
            className="flex-1 py-2 px-5 overflow-y-auto overflow-x-hidden custom-scrollbar min-w-0"
          >
            <SettingsConfigProvider value={{ config, tempConfig, setTempConfig, saving }}>
              <SettingsSearchContext.Provider value={sidebarQuery}>
                {renderTabContent()}
                {sidebarQuery && !searchHasResults && !loading && !error && (
                  <p role="status" className="py-8 text-center font-minecraft text-sm text-white/70 break-words">
                    {t("settings.search.no_results", { query: debouncedSearch.trim() })}
                  </p>
                )}
              </SettingsSearchContext.Provider>
            </SettingsConfigProvider>
          </div>
        </div>
      </div>
    </Modal>
  );
}
