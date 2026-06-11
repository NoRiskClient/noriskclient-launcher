"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { gsap } from "gsap";
import { cn } from "../../lib/utils";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { RunningInstancesIndicator } from "../process/RunningInstancesIndicator";
import { CurrentAccountDisplay } from "../account/CurrentAccountDisplay";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { MinecraftAccountManager } from "../account/MinecraftAccountManager";
import { IconButton } from "../ui/buttons/IconButton";
import { useSocialsModalStore } from "../../store/socials-modal-store";
import { useFriendsStore } from "../../store/friends-store";
import { Icon } from "@iconify/react";
import { NotificationBell } from "./NotificationBell";
import { LocalServerService } from "../../services/local-server-service";
import type { LocalServer } from "../../types/localServer";
import { handleIconImgLoad } from "../profiles/IconPicker";

interface UserProfileBarProps {
  className?: string;
  onOpenServers?: (serverId?: string) => void;
}

export function UserProfileBar({ className, onOpenServers }: UserProfileBarProps) {
  const { t } = useTranslation();
  const profileButtonRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const serversButtonRef = useRef<HTMLDivElement>(null);
  const serversCloseTimerRef = useRef<number | null>(null);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [isServersOpen, setIsServersOpen] = useState(false);
  const [servers, setServers] = useState<LocalServer[]>([]);
  const [serversLoaded, setServersLoaded] = useState(false);
  const [serversMenuPosition, setServersMenuPosition] = useState({ top: 64, right: 120 });
  const { initializeAccounts } = useMinecraftAuthStore();
  const [_, setMounted] = useState(false);
  const { openModal: openSocialsModal } = useSocialsModalStore();
  const { toggleSidebar: toggleFriendsSidebar } = useFriendsStore();

  useEffect(() => {
    setMounted(true);
    initializeAccounts();
    return () => {
      setMounted(false);
      if (serversCloseTimerRef.current !== null) {
        window.clearTimeout(serversCloseTimerRef.current);
      }
    };
  }, [initializeAccounts]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".profile-bar-container", {
        opacity: 0,
        y: -10,
        duration: 0.5,
        ease: "power3.out",
      });
    });

    return () => ctx.revert();
  }, []);

  const toggleAccountDropdown = () => {
    setIsAccountDropdownOpen(!isAccountDropdownOpen);
  };

  const handleCloseDropdown = () => {
    setIsAccountDropdownOpen(false);
  };

  const loadServers = async () => {
    try {
      const next = await LocalServerService.listServers();
      setServers(next);
      setServersLoaded(true);
    } catch (error) {
      console.error("Failed to load local servers for header menu:", error);
      setServersLoaded(true);
    }
  };

  const cancelServersClose = () => {
    if (serversCloseTimerRef.current !== null) {
      window.clearTimeout(serversCloseTimerRef.current);
      serversCloseTimerRef.current = null;
    }
  };

  const closeServersMenuSoon = () => {
    cancelServersClose();
    serversCloseTimerRef.current = window.setTimeout(() => {
      setIsServersOpen(false);
      serversCloseTimerRef.current = null;
    }, 450);
  };

  const openServersMenu = () => {
    cancelServersClose();
    const rect = serversButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setServersMenuPosition({
        top: Math.round(rect.bottom + 2),
        right: Math.max(16, Math.round(window.innerWidth - rect.right)),
      });
    }
    setIsServersOpen(true);
    loadServers();
  };

  const openServer = (serverId?: string) => {
    setIsServersOpen(false);
    onOpenServers?.(serverId);
  };

  const onlineServers = servers.filter((server) => server.status === "running");
  const offlineServers = servers.filter((server) => server.status !== "running");

  return (
    <div className={cn("relative flex items-center gap-3", className)}>
      <div className="profile-bar-container flex items-center gap-2">
        <NotificationBell />
        <div
          ref={serversButtonRef}
          className="relative"
          onMouseEnter={openServersMenu}
          onMouseLeave={closeServersMenuSoon}
        >
          <IconButton
            icon={<Icon icon="solar:server-square-bold" className="w-5 h-5" />}
            onClick={() => openServer()}
            variant="flat"
            size="sm"
            aria-label="Servers"
            className="text-white/70 hover:text-white h-10 w-10"
          />
          {isServersOpen && typeof document !== "undefined" && createPortal(
            <div
              className="fixed w-80 border-2 border-white/15 bg-[#090d13]/95 backdrop-blur-md shadow-2xl p-3 pointer-events-auto"
              style={{ top: serversMenuPosition.top, right: serversMenuPosition.right, zIndex: 2147483647 }}
              onMouseEnter={cancelServersClose}
              onMouseLeave={closeServersMenuSoon}
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon icon="solar:server-square-bold" className="w-5 h-5 text-white/80" />
                  <span className="font-minecraft text-white text-lg truncate">Servers</span>
                </div>
                <button
                  type="button"
                  onClick={() => openServer()}
                  className="font-minecraft-ten text-white/45 hover:text-white text-sm"
                >
                  Alle
                </button>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
                {!serversLoaded ? (
                  <div className="border border-white/10 bg-white/5 p-3 font-minecraft-ten text-white/45 text-base">
                    Lade Server...
                  </div>
                ) : servers.length === 0 ? (
                  <div className="border border-white/10 bg-white/5 p-3 font-minecraft-ten text-white/45 text-base">
                    Keine Server
                  </div>
                ) : (
                  <>
                    <HeaderServerSection
                      title="Online"
                      servers={onlineServers}
                      total={servers.length}
                      emptyText="Keine laufenden Server"
                      onOpen={openServer}
                    />
                    <HeaderServerSection
                      title="Offline"
                      servers={offlineServers}
                      total={servers.length}
                      emptyText="Keine Offline-Server"
                      onOpen={openServer}
                    />
                  </>
                )}
              </div>
            </div>,
            document.body,
          )}
        </div>
        <RunningInstancesIndicator />

        <div ref={profileButtonRef}>
          <CurrentAccountDisplay
            onClick={toggleAccountDropdown}
            className="h-10"
          />
        </div>

        <IconButton
          icon={<Icon icon="solar:users-group-rounded-linear" className="w-5 h-5" />}
          onClick={toggleFriendsSidebar}
          variant="flat"
          size="sm"
          aria-label={t('header.toggle_friends')}
          className="text-white/70 hover:text-white h-10 w-10"
        />

        <IconButton
          icon={<Icon icon="solar:link-linear" className="w-5 h-5" />}
          onClick={openSocialsModal}
          variant="flat"
          size="sm"
          aria-label={t('header.open_socials')}
          className="text-white/70 hover:text-white h-10 w-10"
        />
      </div>

  

      <Dropdown
        ref={dropdownRef}
        isOpen={isAccountDropdownOpen}
        onClose={handleCloseDropdown}
        triggerRef={profileButtonRef}
        width={300}
      >
        <MinecraftAccountManager onClose={handleCloseDropdown} isInDropdown />
      </Dropdown>
    </div>
  );
}

function HeaderServerSection({
  title,
  servers,
  total,
  emptyText,
  onOpen,
}: {
  title: "Online" | "Offline";
  servers: LocalServer[];
  total: number;
  emptyText: string;
  onOpen: (serverId?: string) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 px-1 pt-1">
        <span className={`w-2.5 h-2.5 rounded-full ${title === "Online" ? "bg-emerald-400" : "bg-white/25"}`} />
        <span className="font-minecraft-ten text-white/70 text-xs uppercase">
          {title} {servers.length} aus {total}
        </span>
      </div>
      {servers.length === 0 ? (
        <div className="border border-white/10 bg-white/5 p-3 font-minecraft-ten text-white/35 text-sm">
          {emptyText}
        </div>
      ) : (
        servers.map((server) => (
          <button
            key={server.id}
            type="button"
            onClick={() => onOpen(server.id)}
            className="w-full border border-white/10 bg-white/5 hover:bg-white/10 p-3 grid grid-cols-[40px_1fr_auto] gap-3 items-center text-left transition-colors"
          >
            <div className="w-10 h-10 border border-white/10 bg-black/35 flex items-center justify-center overflow-hidden">
              {serverIconSrc(server.iconPath) ? (
                <img
                  src={serverIconSrc(server.iconPath) ?? undefined}
                  className="w-full h-full object-cover scale-[1.02]"
                  style={{ imageRendering: "pixelated" }}
                  onLoad={handleIconImgLoad}
                  alt=""
                />
              ) : (
                <Icon icon={server.serverType === "bedrock" ? "solar:box-bold" : "solar:server-square-bold"} className="w-6 h-6 text-white/70" />
              )}
            </div>
            <span className="min-w-0">
              <span className="block font-minecraft-ten text-white text-base truncate">{server.name}</span>
              <span className="block font-minecraft-ten text-white/45 text-xs truncate">
                {server.serverIp || "localhost"}:{server.port}
              </span>
            </span>
            <span className="flex items-center gap-2 font-minecraft-ten text-white/55 text-xs">
              <span className={`w-2.5 h-2.5 rounded-full ${server.status === "running" ? "bg-emerald-400" : "bg-white/25"}`} />
              {server.status === "running" ? "Online" : "Offline"}
            </span>
          </button>
        ))
      )}
    </section>
  );
}

function serverIconSrc(value?: string | null) {
  if (!value || value.startsWith("preset:")) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return convertFileSrc(value);
}
