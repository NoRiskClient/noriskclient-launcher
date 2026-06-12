"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { ActionButtons, type ActionButton } from "../ui/ActionButtons";
import { Button } from "../ui/buttons/Button";
import { Input, SearchStyleTextArea } from "../ui/Input";
import { SearchWithFilters } from "../ui/SearchWithFilters";
import { TabLayout } from "../ui/TabLayout";
import { IconPicker, type ChosenIcon, handleIconImgLoad } from "../profiles/IconPicker";
import { LocalServerService } from "../../services/local-server-service";
import { useFriendsStore } from "../../store/friends-store";
import type {
  CreateLocalServerInput,
  InstalledServerContent,
  ImportLocalServerInput,
  LocalServer,
  LocalServerContentKind,
  LocalServerFileEntry,
  LocalServerKind,
  LocalServerLogEvent,
  LoaderVersionEntry,
  MinecraftVersionEntry,
  ServerBackup,
  ServerCatalogResult,
  UpdateLocalServerSettingsInput,
} from "../../types/localServer";
import { setDiscordState } from "../../utils/discordRpc";
import { EditionSwitch, useLauncherEdition } from "../edition/EditionSwitch";
import { useProfileStore } from "../../store/profile-store";

type SortMode = "last_played" | "name" | "date_created" | "version_newest" | "version_oldest";
type DetailTab =
  | "console"
  | "files"
  | "minecraftProperties"
  | "content"
  | "resourcepacks"
  | "backups"
  | "users"
  | "database"
  | "startup"
  | "settings"
  | "mcp";

type WizardStep = "version" | "loader" | "details" | "codex";
type VersionChannel = "all" | "release" | "snapshot";

const defaultInput: CreateLocalServerInput = {
  name: "",
  serverType: "paper",
  serverKind: "plugins",
  minecraftVersion: "1.21.4",
  loaderVersion: "",
  serverIp: "",
  port: 25565,
  ramMb: 4096,
  javaPath: "",
  description: "",
  iconPath: "",
  codexEnabled: false,
  codexMcpPort: 8765,
  autoUpdateContent: true,
};

const wizardSteps: { id: WizardStep; label: string; icon: string }[] = [
  { id: "version", label: "Version", icon: "solar:layers-bold" },
  { id: "loader", label: "Loader", icon: "solar:server-square-bold" },
  { id: "details", label: "Profil", icon: "solar:user-id-bold" },
  { id: "codex", label: "Codex", icon: "solar:code-bold" },
];

const fallbackReleaseVersions = [
  "1.21.4",
  "1.21.3",
  "1.21.1",
  "1.21",
  "1.20.6",
  "1.20.4",
  "1.20.1",
  "1.19.4",
  "1.19.2",
  "1.18.2",
  "1.17.1",
  "1.16.5",
];

const fallbackSnapshotVersions = ["24w46a", "24w45a", "24w44a", "24w40a", "23w51b", "23w51a"];

const loaderOptions: {
  id: CreateLocalServerInput["serverType"];
  title: string;
  subtitle: string;
  icon: string;
  kind: LocalServerKind;
}[] = [
  {
    id: "paper",
    title: "Paper",
    subtitle: "Plugins und stabile Server",
    icon: "solar:bolt-bold",
    kind: "plugins",
  },
  {
    id: "spigot",
    title: "Spigot",
    subtitle: "Plugin-Server kompatibel",
    icon: "solar:plug-circle-bold",
    kind: "plugins",
  },
  {
    id: "bukkit",
    title: "Bukkit",
    subtitle: "Klassische Plugin-Basis",
    icon: "solar:plug-circle-bold",
    kind: "plugins",
  },
  {
    id: "fabric",
    title: "Fabric",
    subtitle: "Mods und Modpacks",
    icon: "solar:box-bold",
    kind: "modpack",
  },
  {
    id: "forge",
    title: "Forge",
    subtitle: "Forge-Mods und Modpacks",
    icon: "solar:hammer-bold",
    kind: "modpack",
  },
  {
    id: "neoforge",
    title: "NeoForge",
    subtitle: "NeoForge-Mods",
    icon: "solar:stars-bold",
    kind: "modpack",
  },
  {
    id: "vanilla",
    title: "Vanilla",
    subtitle: "Originaler Minecraft-Server",
    icon: "solar:gamepad-bold",
    kind: "vanilla",
  },
  {
    id: "bedrock",
    title: "Bedrock",
    subtitle: "Bedrock Dedicated Server",
    icon: "solar:box-bold",
    kind: "bedrock",
  },
];

export function ServersTab() {
  const { edition } = useLauncherEdition();
  const [servers, setServers] = useState<LocalServer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>("last_played");
  const [versionFilter, setVersionFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [creatingServer, setCreatingServer] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("console");
  const [overviewAction, setOverviewAction] = useState<Record<string, "start" | "stop" | "restart" | undefined>>({});

  const selected = useMemo(
    () => servers.find((server) => server.id === selectedId) ?? null,
    [servers, selectedId],
  );

  const refresh = async () => {
    const next = await LocalServerService.listServers();
    setServers(next);
  };

  const selectServer = (serverId: string) => {
    setSelectedId(serverId);
    setDetailTab("console");
    localStorage.removeItem("nrc-open-server-id");
  };

  useEffect(() => {
    setDiscordState("Managing Servers");
    refresh().catch((error) => toast.error(error.message ?? String(error)));
    let unlisten: (() => void) | undefined;
    LocalServerService.listenForLogs((event: LocalServerLogEvent) => {
      setLogs((current) => ({
        ...current,
        [event.serverId]: [...(current[event.serverId] ?? []), event.line].slice(-500),
      }));
    }).then((off) => {
      unlisten = off;
    });

    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const handleOpenServer = (event: Event) => {
      const serverId = (event as CustomEvent<string>).detail;
      if (serverId) selectServer(serverId);
    };
    window.addEventListener("nrc-open-server", handleOpenServer);
    const pendingServerId = localStorage.getItem("nrc-open-server-id");
    if (pendingServerId) selectServer(pendingServerId);
    return () => window.removeEventListener("nrc-open-server", handleOpenServer);
  }, []);

  const updateServer = (server: LocalServer) => {
    setServers((current) => current.map((item) => (item.id === server.id ? server : item)));
  };

  const runOverviewAction = async (
    server: LocalServer,
    action: "start" | "stop" | "restart",
  ) => {
    setOverviewAction((current) => ({ ...current, [server.id]: action }));
    try {
      const updated = await toast.promise(
        action === "start"
          ? LocalServerService.startServer(server.id)
          : action === "stop"
            ? LocalServerService.stopServer(server.id)
            : LocalServerService.restartServer(server.id),
        {
          loading: action === "start" ? "Server startet..." : action === "stop" ? "Server stoppt..." : "Server restartet...",
          success: action === "start" ? "Server gestartet" : action === "stop" ? "Server gestoppt" : "Server restartet",
          error: (error) => error.message ?? String(error),
        },
      );
      updateServer(updated);
      await refresh();
    } finally {
      setOverviewAction((current) => ({ ...current, [server.id]: undefined }));
    }
  };

  const duplicateServer = async (server: LocalServer) => {
    const copy = await toast.promise(LocalServerService.duplicateServer(server.id), {
      loading: "Server wird kopiert...",
      success: "Server kopiert",
      error: (error) => error.message ?? String(error),
    });
    setServers((current) => [...current, copy]);
    setSelectedId(copy.id);
    setDetailTab("console");
  };

  const deleteServer = async (server: LocalServer) => {
    const confirmed = window.confirm(`Server "${server.name}" wirklich löschen? Der Serverordner wird entfernt.`);
    if (!confirmed) return;
    await toast.promise(LocalServerService.deleteServer(server.id), {
      loading: "Server wird gelöscht...",
      success: "Server gelöscht",
      error: (error) => error.message ?? String(error),
    });
    setServers((current) => current.filter((item) => item.id !== server.id));
    setSelectedId(null);
    await refresh();
  };

  const filteredServers = servers
    .filter((server) => {
      const matchesEdition = edition === "bedrock" ? server.serverType === "bedrock" : server.serverType !== "bedrock";
      const matchesSearch =
        !searchQuery ||
        server.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        server.minecraftVersion.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (server.description ?? "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchesVersion =
        versionFilter === "all" || server.minecraftVersion.includes(versionFilter);
      return matchesEdition && matchesSearch && matchesVersion;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "date_created":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "version_newest":
          return b.minecraftVersion.localeCompare(a.minecraftVersion, undefined, { numeric: true });
        case "version_oldest":
          return a.minecraftVersion.localeCompare(b.minecraftVersion, undefined, { numeric: true });
        default:
          return new Date(b.lastStartedAt ?? b.createdAt).getTime() - new Date(a.lastStartedAt ?? a.createdAt).getTime();
      }
    });
  const filteredOnlineServers = filteredServers.filter((server) => server.status === "running");
  const filteredOfflineServers = filteredServers.filter((server) => server.status !== "running");
  const nextJavaPort = nextAvailablePort(servers, 25565);
  const nextBedrockPort = nextAvailablePort(servers, 19132);

  const actions: ActionButton[] = [
    {
      id: "import",
      label: "Importieren",
      icon: "solar:upload-bold",
      tooltip: "Server importieren",
      onClick: () => setShowImport(true),
    },
    {
      id: "create",
      label: "Erstellen",
      icon: "solar:widget-add-bold",
      tooltip: "Server erstellen",
      onClick: () => setShowCreate(true),
    },
  ];

  if (selected) {
    return (
      <TabLayout
        title={selected.name}
        icon="solar:server-square-bold"
        actions={
          <Button
            size="sm"
            icon={<Icon icon="solar:alt-arrow-left-bold" className="w-5 h-5" />}
            onClick={() => setSelectedId(null)}
          >
            Zurück
          </Button>
        }
      >
        <ServerDetail
          server={selected}
          tab={detailTab}
          logs={logs[selected.id] ?? []}
          onTabChange={setDetailTab}
          onUpdate={updateServer}
          onRefresh={refresh}
          onStartConsole={() => setDetailTab("console")}
          onDuplicate={() => duplicateServer(selected)}
          onDelete={() => deleteServer(selected)}
        />
      </TabLayout>
    );
  }

  return (
    <TabLayout title="Servers" icon="solar:server-square-bold">
      <div className="h-full flex flex-col overflow-hidden p-4 relative">
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="mb-6 pb-4 border-b border-white/10">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 flex-1">
                <SearchWithFilters
                  placeholder="Server durchsuchen"
                  searchValue={searchQuery}
                  onSearchChange={setSearchQuery}
                  sortOptions={[
                    { value: "last_played", label: "Zuletzt gestartet", icon: "solar:clock-circle-bold" },
                    { value: "name", label: "Name", icon: "solar:text-bold" },
                    { value: "date_created", label: "Erstellt", icon: "solar:calendar-add-bold" },
                    { value: "version_newest", label: "Version neu", icon: "solar:arrow-down-bold" },
                    { value: "version_oldest", label: "Version alt", icon: "solar:arrow-up-bold" },
                  ]}
                  sortValue={sortBy}
                  onSortChange={(value) => setSortBy(value as SortMode)}
                  filterOptions={[
                    { value: "all", label: "Alle Versionen", icon: "solar:layers-bold" },
                    { value: "1.21", label: "1.21.x", icon: "solar:gamepad-bold" },
                    { value: "1.20", label: "1.20.x", icon: "solar:gamepad-bold" },
                    { value: "1.19", label: "1.19.x", icon: "solar:gamepad-bold" },
                  ]}
                  filterValue={versionFilter}
                  onFilterChange={setVersionFilter}
                  dropdownSize="sm"
                />
              </div>
              <EditionSwitch />
              <ActionButtons actions={actions} />
            </div>
          </div>

          {filteredServers.length === 0 ? (
            <div className="h-72 border-2 border-white/10 bg-black/35 backdrop-blur-md flex items-center justify-center text-white/60 font-minecraft-ten text-xl">
              Keine Server gefunden
            </div>
          ) : (
            <div className="space-y-6">
              <ServerStatusSection
                title="Online"
                servers={filteredOnlineServers}
                total={filteredServers.length}
                emptyText="Keine laufenden Server"
                pendingActions={overviewAction}
                onOpen={selectServer}
                onAction={runOverviewAction}
              />
              <ServerStatusSection
                title="Offline"
                servers={filteredOfflineServers}
                total={filteredServers.length}
                emptyText="Keine Offline-Server"
                pendingActions={overviewAction}
                onOpen={selectServer}
                onAction={runOverviewAction}
              />
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateServerWizard
          initialPort={nextJavaPort}
          initialBedrockPort={nextBedrockPort}
          edition={edition}
          onClose={() => setShowCreate(false)}
          onCreatingChange={setCreatingServer}
          onCreated={(server) => {
            setServers((current) => [...current, server]);
            setSelectedId(server.id);
            setDetailTab("console");
            setShowCreate(false);
          }}
        />
      )}

      {showImport && (
        <ImportServerModal
          onClose={() => setShowImport(false)}
          onImported={(server) => {
            setServers((current) => [...current, server]);
            setSelectedId(server.id);
            setDetailTab("console");
            setShowImport(false);
          }}
        />
      )}

      {creatingServer && <CreatingOverlay />}
    </TabLayout>
  );
}

function ServerStatusSection({
  title,
  servers,
  total,
  emptyText,
  pendingActions,
  onOpen,
  onAction,
}: {
  title: "Online" | "Offline";
  servers: LocalServer[];
  total: number;
  emptyText: string;
  pendingActions: Record<string, "start" | "stop" | "restart" | undefined>;
  onOpen: (serverId: string) => void;
  onAction: (server: LocalServer, action: "start" | "stop" | "restart") => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full ${title === "Online" ? "bg-emerald-400" : "bg-white/25"}`} />
        <h2 className="font-minecraft text-white text-2xl lowercase">{title}</h2>
        <span className="font-minecraft-ten text-white/45 text-base">
          {servers.length} aus {total}
        </span>
      </div>
      {servers.length === 0 ? (
        <div className="border border-white/10 bg-black/25 px-4 py-5 font-minecraft-ten text-white/45 text-base">
          {emptyText}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              pendingAction={pendingActions[server.id]}
              onOpen={() => onOpen(server.id)}
              onAction={(action) => onAction(server, action)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ServerCard({
  server,
  pendingAction,
  onOpen,
  onAction,
}: {
  server: LocalServer;
  pendingAction?: "start" | "stop" | "restart";
  onOpen: () => void;
  onAction: (action: "start" | "stop" | "restart") => void;
}) {
  const contentCount = server.installedContent.length;
  const kindLabel = server.serverType === "bedrock" ? "Bedrock Server" : server.serverType === "vanilla" ? "Vanilla Server" : isPluginServer(server) ? "Plugin Server" : "Modpack Server";
  const endpoint = `${server.serverIp || "localhost"}:${server.port}`;
  const isRunning = server.status === "running";
  const busy = Boolean(pendingAction);

  return (
    <article className="group border-2 border-white/10 bg-black/40 hover:bg-white/10 hover:border-white/25 transition-all p-4 min-h-[220px] flex flex-col justify-between">
      <button type="button" onClick={onOpen} className="text-left w-full">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden">
            {iconImageSrc(server.iconPath) ? (
              <img src={iconImageSrc(server.iconPath)} className="w-full h-full object-cover scale-[1.02]" style={{ imageRendering: "pixelated" }} onLoad={handleIconImgLoad} />
            ) : (
              <Icon icon={iconForServer(server)} className="w-9 h-9 text-white/75" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-minecraft text-white text-xl truncate">{server.name}</h2>
              <span className={`w-3 h-3 rounded-full ${isRunning ? "bg-emerald-400" : "bg-white/30"}`} />
            </div>
            <p className="font-minecraft-ten text-white/60 text-base mt-1 truncate">
              {kindLabel} / {server.serverType} / {server.minecraftVersion}
            </p>
            <p className="font-minecraft-ten text-white/45 text-sm mt-2 line-clamp-2">
              {server.description || endpoint}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-4 text-center">
          <Metric label="RAM" value={`${server.ramMb} MB`} />
          <Metric label="Port" value={`:${server.port}`} />
          <Metric label="Inhalte" value={String(contentCount)} />
          <Metric label="Codex" value={server.codexEnabled ? "An" : "Aus"} />
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 mt-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction(isRunning ? "stop" : "start")}
          className={`h-10 flex-1 rounded-full border disabled:opacity-45 disabled:cursor-not-allowed font-minecraft-ten text-base flex items-center justify-center gap-2 transition-colors ${
            isRunning
              ? "border-white/15 bg-white/10 hover:bg-white/15 text-white"
              : "border-emerald-300/55 bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-50"
          }`}
        >
          <Icon icon={isRunning ? "solar:stop-bold" : "solar:play-bold"} className="w-4 h-4" />
          {pendingAction === "start" ? "Startet" : pendingAction === "stop" ? "Stoppt" : isRunning ? "Stop" : "Spielen"}
        </button>
        <button
          type="button"
          disabled={busy || !isRunning}
          onClick={() => onAction("restart")}
          className="h-10 flex-1 rounded-full border border-orange-300/50 bg-orange-500/20 hover:bg-orange-500/30 disabled:opacity-45 disabled:cursor-not-allowed font-minecraft-ten text-orange-50 text-base flex items-center justify-center gap-2 transition-colors"
        >
          <Icon icon="solar:refresh-bold" className={`w-4 h-4 ${pendingAction === "restart" ? "animate-spin" : ""}`} />
          {pendingAction === "restart" ? "Restartet" : "Restart"}
        </button>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/35 border border-white/10 px-2 py-2 min-w-0">
      <div className="font-minecraft-ten text-white/45 text-xs truncate">{label}</div>
      <div className="font-minecraft-ten text-white text-sm truncate">{value}</div>
    </div>
  );
}

function CreateServerWizard({
  initialPort,
  initialBedrockPort,
  edition,
  onClose,
  onCreatingChange,
  onCreated,
}: {
  initialPort: number;
  initialBedrockPort: number;
  edition: "java" | "bedrock";
  onClose: () => void;
  onCreatingChange: (creating: boolean) => void;
  onCreated: (server: LocalServer) => void;
}) {
  const profiles = useProfileStore((state) => state.profiles);
  const fetchProfiles = useProfileStore((state) => state.fetchProfiles);
  const [step, setStep] = useState<WizardStep>(edition === "bedrock" ? "loader" : "version");
  const [input, setInput] = useState<CreateLocalServerInput>(() => edition === "bedrock"
    ? { ...defaultInput, serverType: "bedrock", serverKind: "bedrock", minecraftVersion: "latest", port: initialBedrockPort, ramMb: 2048 }
    : { ...defaultInput, port: initialPort });
  const [versionChannel, setVersionChannel] = useState<VersionChannel>("all");
  const [versionSearch, setVersionSearch] = useState("");
  const [versions, setVersions] = useState<MinecraftVersionEntry[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeWizardSteps = edition === "bedrock"
    ? wizardSteps.filter((item) => item.id !== "version")
    : wizardSteps;
  const stepIndex = activeWizardSteps.findIndex((item) => item.id === step);
  const fallbackVersions: MinecraftVersionEntry[] = [
    ...fallbackReleaseVersions.map((id) => ({ id, versionType: "release" })),
    ...fallbackSnapshotVersions.map((id) => ({ id, versionType: "snapshot" })),
  ];
  const versionSource = versions.length ? versions : fallbackVersions;
  const filteredVersions = versionSource.filter((version) =>
    (versionChannel === "all" || version.versionType === versionChannel) &&
    version.id.toLowerCase().includes(versionSearch.toLowerCase()),
  );

  useEffect(() => {
    void fetchProfiles();
    if (edition === "bedrock") return;
    setVersionsLoading(true);
    LocalServerService.listMinecraftVersions()
      .then((items) => {
        setVersions(items);
        const latestRelease = items.find((item) => item.versionType === "release") ?? items[0];
        if (latestRelease && input.minecraftVersion === defaultInput.minecraftVersion) {
          setInput((current) => ({ ...current, minecraftVersion: latestRelease.id }));
        }
      })
      .catch(() => toast.error("Minecraft-Versionen konnten nicht geladen werden. Fallback ist aktiv."))
      .finally(() => setVersionsLoading(false));
  }, [edition, fetchProfiles]);

  const goNext = () => {
    const next = activeWizardSteps[stepIndex + 1];
    if (next) setStep(next.id);
  };

  const goBack = () => {
    const previous = activeWizardSteps[stepIndex - 1];
    if (previous) setStep(previous.id);
  };

  const create = async () => {
    if (!input.minecraftVersion.trim()) {
      toast.error("Bitte wähle eine Version aus.");
      setStep("version");
      return;
    }
    if (!input.name.trim()) {
      toast.error("Bitte gib einen Profilnamen ein.");
      setStep("details");
      return;
    }

    try {
      setBusy(true);
      onCreatingChange(true);
      onClose();
      const server = await toast.promise(LocalServerService.createServer({
        ...input,
        name: input.name.trim(),
        serverIp: input.serverIp?.trim() ?? "",
        iconPath: input.iconPath?.trim() ?? "",
      }), {
        loading: "Server wird erstellt...",
        success: "Server erstellt",
        error: (error) => error.message ?? String(error),
      });
      onCreated(server);
    } finally {
      setBusy(false);
      onCreatingChange(false);
    }
  };

  return (
    <ModalFrame title="Server erstellen" onClose={onClose}>
      {showIconPicker && (
        <IconPicker
          selected={chosenIconFromValue(input.iconPath)}
          onSelect={(icon) => setInput({ ...input, iconPath: valueFromChosenIcon(icon) })}
          onClose={() => setShowIconPicker(false)}
        />
      )}
      <div className={`grid ${edition === "bedrock" ? "grid-cols-3" : "grid-cols-4"} gap-2 mb-5`}>
        {activeWizardSteps.map((item) => (
          <button
            key={item.id}
            onClick={() => setStep(item.id)}
            className={`border px-3 py-2 font-minecraft-ten text-lg flex items-center justify-center gap-2 ${
              step === item.id ? "border-white/50 bg-white/15 text-white" : "border-white/10 bg-black/30 text-white/50"
            }`}
          >
            <Icon icon={item.icon} className="w-4 h-4" />
            {item.label}
          </button>
        ))}
      </div>

      {step === "version" && edition === "java" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setVersionChannel("all")}
              className={`h-[48px] border font-minecraft-ten text-lg ${versionChannel === "all" ? "border-emerald-300/60 bg-emerald-500/15 text-white" : "border-white/10 bg-black/35 text-white/60"}`}
            >
              Alle
            </button>
            <button
              type="button"
              onClick={() => setVersionChannel("release")}
              className={`h-[48px] border font-minecraft-ten text-lg ${versionChannel === "release" ? "border-emerald-300/60 bg-emerald-500/15 text-white" : "border-white/10 bg-black/35 text-white/60"}`}
            >
              Release
            </button>
            <button
              type="button"
              onClick={() => setVersionChannel("snapshot")}
              className={`h-[48px] border font-minecraft-ten text-lg ${versionChannel === "snapshot" ? "border-emerald-300/60 bg-emerald-500/15 text-white" : "border-white/10 bg-black/35 text-white/60"}`}
            >
              Snapshot
            </button>
          </div>
          <Input value={versionSearch} onChange={(event) => setVersionSearch(event.target.value)} placeholder="Version suchen" />
          {versionsLoading && (
            <div className="border border-white/10 bg-black/30 px-3 py-2 font-minecraft-ten text-white/55 text-base">
              Lade alle Minecraft-Versionen...
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 max-h-[330px] overflow-y-auto custom-scrollbar pr-1">
            {filteredVersions.map((version) => (
              <button
                type="button"
                key={version.id}
                onClick={() => setInput({ ...input, minecraftVersion: version.id })}
                className={`h-[76px] border p-3 text-left transition-colors ${
                  input.minecraftVersion === version.id ? "border-emerald-300/70 bg-emerald-500/15" : "border-white/10 bg-black/35 hover:bg-white/10"
                }`}
              >
                <p className="font-minecraft text-white text-xl">{version.id}</p>
                <p className="font-minecraft-ten text-white/50 text-sm">{version.versionType}</p>
              </button>
            ))}
          </div>
          <Input value={input.minecraftVersion} onChange={(event) => setInput({ ...input, minecraftVersion: event.target.value })} placeholder="Eigene Version einfügen" />
        </div>
      )}

      {step === "loader" && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {loaderOptions.filter((loader) => edition === "bedrock" ? loader.id === "bedrock" : loader.id !== "bedrock").map((loader) => (
              <button
                type="button"
                key={loader.id}
                onClick={() => setInput({
                  ...input,
                  serverType: loader.id,
                  serverKind: loader.kind,
                  loaderVersion: loaderVersionServerType(loader.id) ? input.loaderVersion : "",
                  port: loader.id === "bedrock" ? initialBedrockPort : input.serverType === "bedrock" ? initialPort : input.port,
                  minecraftVersion: loader.id === "bedrock" ? "latest" : input.minecraftVersion === "latest" ? defaultInput.minecraftVersion : input.minecraftVersion,
                })}
                className={`min-h-[150px] border p-4 text-left transition-colors ${
                  input.serverType === loader.id ? "border-emerald-300/70 bg-emerald-500/15" : "border-white/10 bg-black/35 hover:bg-white/10"
                }`}
              >
                <Icon icon={loader.icon} className="w-9 h-9 text-white mb-4" />
                <p className="font-minecraft text-white text-xl">{loader.title}</p>
                <p className="font-minecraft-ten text-white/55 text-base mt-1">{loader.subtitle}</p>
              </button>
            ))}
          </div>
          {loaderVersionServerType(input.serverType) && (
            <Input value={input.loaderVersion ?? ""} onChange={(event) => setInput({ ...input, loaderVersion: event.target.value })} placeholder={`${loaderLabel(input.serverType)} Loader-Version optional`} />
          )}
        </div>
      )}

      {step === "details" && (
        <div className="grid grid-cols-[240px_1fr] gap-5">
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setShowIconPicker(true)}
              className="w-full aspect-square border-2 border-white/15 bg-black/35 flex items-center justify-center overflow-hidden hover:bg-white/10 transition-colors"
            >
              {iconImageSrc(input.iconPath) ? (
                <img src={iconImageSrc(input.iconPath)} className="w-full h-full object-cover scale-[1.02]" style={{ imageRendering: "pixelated" }} onLoad={handleIconImgLoad} />
              ) : (
                <Icon icon={iconForInput(input)} className="w-16 h-16 text-white/75" />
              )}
            </button>
            <p className="font-minecraft-ten text-white/50 text-center text-base">
              Profilbild anklicken
            </p>
          </div>
          <div className="space-y-3">
            {edition === "java" && (
              <label className="block font-minecraft-ten text-white/55 text-sm">
                Inhalte aus Java-Profil übernehmen
                <select
                  value={input.sourceProfileId ?? ""}
                  onChange={(event) => {
                    const profile = profiles.find((item) => item.id === event.target.value);
                    if (!profile) {
                      setInput({ ...input, sourceProfileId: null });
                      return;
                    }
                    const serverType = profile.loader === "fabric" || profile.loader === "forge" || profile.loader === "neoforge"
                      ? profile.loader
                      : "paper";
                    setInput({
                      ...input,
                      sourceProfileId: profile.id,
                      name: input.name || `${profile.name} Server`,
                      minecraftVersion: profile.game_version,
                      serverType,
                      serverKind: kindForServerType(serverType),
                      loaderVersion: profile.loader_version ?? "",
                    });
                  }}
                  className="mt-2 w-full h-11 rounded-lg border border-white/10 bg-[#11151b] px-3 text-white outline-none"
                >
                  <option value="">Ohne Profil-Inhalte</option>
                  {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.game_version}</option>)}
                </select>
              </label>
            )}
            <Input value={input.name} onChange={(event) => setInput({ ...input, name: event.target.value })} placeholder="Profilname" />
            <Input value={input.serverIp ?? ""} onChange={(event) => setInput({ ...input, serverIp: event.target.value })} placeholder="Server-IP / Adresse optional, z. B. 0.0.0.0" />
            <div className="grid grid-cols-2 gap-3">
              <Input type="number" value={input.port} onChange={(event) => setInput({ ...input, port: Number(event.target.value) })} placeholder="Port" />
              <Input type="number" value={input.ramMb} onChange={(event) => setInput({ ...input, ramMb: Number(event.target.value) })} placeholder="Arbeitsspeicher MB" />
            </div>
            <input
              type="range"
              min={1024}
              max={16384}
              step={512}
              value={input.ramMb}
              onChange={(event) => setInput({ ...input, ramMb: Number(event.target.value) })}
              className="w-full accent-emerald-400"
            />
            <SearchStyleTextArea
              value={input.description ?? ""}
              onChange={(event) => setInput({ ...input, description: event.target.value })}
              placeholder="Gruppenname oder Notizen optional"
              minHeight="86px"
            />
          </div>
        </div>
      )}

      {step === "codex" && (
        <div className="space-y-3">
          <ToggleRow
            icon="solar:code-bold"
            title="Mit Codex verknüpfen"
            active={Boolean(input.codexEnabled)}
            onClick={() => setInput({ ...input, codexEnabled: !input.codexEnabled })}
          />
          <Input type="number" value={input.codexMcpPort ?? 8765} onChange={(event) => setInput({ ...input, codexMcpPort: Number(event.target.value) })} placeholder="MCP-Port" />
          <ToggleRow
            icon="solar:refresh-bold"
            title="Plugins automatisch updaten"
            active={Boolean(input.autoUpdateContent)}
            onClick={() => setInput({ ...input, autoUpdateContent: !input.autoUpdateContent })}
          />
        </div>
      )}

      <div className="flex justify-between mt-6">
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        <div className="flex gap-3">
          {stepIndex > 0 && <Button onClick={goBack}>Zurück</Button>}
          {stepIndex < activeWizardSteps.length - 1 ? (
            <Button onClick={goNext}>Weiter</Button>
          ) : (
            <Button disabled={busy} onClick={create} icon={<Icon icon="solar:download-bold" className="w-5 h-5" />}>
              Erstellen
            </Button>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}

function ImportServerModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (server: LocalServer) => void;
}) {
  const [input, setInput] = useState<ImportLocalServerInput>({
    ...defaultInput,
    name: "",
    sourcePath: "",
  });
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const selected = await LocalServerService.pickServerFolder();
    if (selected) setInput({ ...input, sourcePath: selected });
  };

  const importServer = async () => {
    setBusy(true);
    try {
      const server = await toast.promise(LocalServerService.importServer(input), {
        loading: "Server wird importiert...",
        success: "Server importiert",
        error: (error) => error.message ?? String(error),
      });
      onImported(server);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame title="Server importieren" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Input value={input.sourcePath} onChange={(event) => setInput({ ...input, sourcePath: event.target.value })} placeholder="Server-Ordner" />
          <Button onClick={pick} icon={<Icon icon="solar:folder-bold" className="w-5 h-5" />}>Ordner</Button>
        </div>
        <Input value={input.name} onChange={(event) => setInput({ ...input, name: event.target.value })} placeholder="Profilname" />
        <div className="grid grid-cols-2 gap-3">
          <Select value={input.serverType} onChange={(value) => setInput({ ...input, serverType: value as CreateLocalServerInput["serverType"], serverKind: kindForServerType(value as CreateLocalServerInput["serverType"]) })}>
            <option value="paper">Paper</option>
            <option value="spigot">Spigot</option>
            <option value="bukkit">Bukkit</option>
            <option value="fabric">Fabric</option>
            <option value="forge">Forge</option>
            <option value="neoforge">NeoForge</option>
            <option value="vanilla">Vanilla</option>
            <option value="bedrock">Bedrock</option>
          </Select>
          <Input value={input.minecraftVersion} onChange={(event) => setInput({ ...input, minecraftVersion: event.target.value })} placeholder="Minecraft-Version" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input value={input.serverIp ?? ""} onChange={(event) => setInput({ ...input, serverIp: event.target.value })} placeholder="Server-IP optional" />
          <Input type="number" value={input.port} onChange={(event) => setInput({ ...input, port: Number(event.target.value) })} placeholder="Port" />
          <Input type="number" value={input.ramMb} onChange={(event) => setInput({ ...input, ramMb: Number(event.target.value) })} placeholder="Arbeitsspeicher MB" />
        </div>
        <ToggleRow
          icon="solar:code-bold"
          title="Mit Codex verknüpfen"
          active={Boolean(input.codexEnabled)}
          onClick={() => setInput({ ...input, codexEnabled: !input.codexEnabled })}
        />
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        <Button disabled={busy} onClick={importServer}>Importieren</Button>
      </div>
    </ModalFrame>
  );
}

function ServerDetail({
  server,
  tab,
  logs,
  onTabChange,
  onUpdate,
  onRefresh,
  onStartConsole,
  onDuplicate,
  onDelete,
}: {
  server: LocalServer;
  tab: DetailTab;
  logs: string[];
  onTabChange: (tab: DetailTab) => void;
  onUpdate: (server: LocalServer) => void;
  onRefresh: () => Promise<void>;
  onStartConsole: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [pendingAction, setPendingAction] = useState<"start" | "stop" | "restart" | null>(null);
  const [openChip, setOpenChip] = useState<"version" | "loader" | null>(null);
  const endpoint = `${server.serverIp || "localhost"}:${server.port}`;
  const primaryKind = primaryContentKind(server);
  const tabs: { id: DetailTab; label: string; icon: string }[] = [
    { id: "console", label: "Konsole", icon: "solar:code-bold" },
    { id: "files", label: "Files", icon: "solar:folder-bold" },
    { id: "minecraftProperties", label: "Minecraft Properties", icon: "solar:document-text-bold" },
    { id: "content", label: "Mods", icon: "solar:widget-bold" },
    { id: "backups", label: "Backups", icon: "solar:archive-bold" },
    { id: "users", label: "Users", icon: "solar:users-group-rounded-bold" },
    { id: "database", label: "Database", icon: "solar:database-bold" },
    { id: "startup", label: "Startup", icon: "solar:rocket-bold" },
    { id: "settings", label: "Settings", icon: "solar:settings-bold" },
    { id: "mcp", label: "MCP", icon: "solar:code-square-bold" },
  ];

  const runAction = async (label: string, action: () => Promise<LocalServer | void>, pending?: typeof pendingAction) => {
    if (pending) setPendingAction(pending);
    try {
      const result = await toast.promise(action(), {
        loading: `${label}...`,
        success: `${label} fertig`,
        error: (error) => error.message ?? String(error),
      });
      if (result) onUpdate(result);
      await onRefresh();
    } finally {
      if (pending) setPendingAction(null);
    }
  };

  const updateSettings = async (settings: UpdateLocalServerSettingsInput, label: string) => {
    const updated = await toast.promise(LocalServerService.updateSettings(server.id, settings), {
      loading: `${label} wird gespeichert...`,
      success: `${label} gespeichert`,
      error: (error) => error.message ?? String(error),
    });
    onUpdate(updated);
    await onRefresh();
  };

  const copyEndpoint = async () => {
    await navigator.clipboard.writeText(endpoint);
    toast.success("Server-Adresse kopiert");
  };

  return (
    <div className="h-full min-h-0 grid grid-cols-[260px_1fr] gap-5">
      <aside className="border-2 border-white/10 bg-black/45 backdrop-blur-md p-4 min-h-0 flex flex-col">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-14 h-14 bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden">
            {iconImageSrc(server.iconPath) ? <img src={iconImageSrc(server.iconPath)} className="w-full h-full object-cover scale-[1.02]" style={{ imageRendering: "pixelated" }} onLoad={handleIconImgLoad} /> : <Icon icon={iconForServer(server)} className="w-8 h-8 text-white/75" />}
          </div>
          <div className="min-w-0">
            <h2 className="font-minecraft text-white text-lg truncate">{server.name}</h2>
            <p className="font-minecraft-ten text-white/55 text-sm">{statusLabel(server.status)}</p>
          </div>
        </div>

        <div className="space-y-2 overflow-y-auto custom-scrollbar">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-3 border font-minecraft-ten text-lg transition-colors ${
                tab === item.id ? "bg-white/15 border-white/35 text-white" : "bg-black/25 border-white/10 text-white/60 hover:text-white"
              }`}
            >
              <Icon icon={item.icon} className="w-5 h-5" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="min-h-0 flex flex-col gap-4">
        <div className="border-2 border-white/10 bg-black/45 backdrop-blur-md p-5 flex items-start justify-between gap-5">
          <div className="min-w-0 flex items-start gap-4">
            <button
              type="button"
              onClick={() => onTabChange("settings")}
              className="w-24 h-24 border-2 border-white/15 bg-black/35 flex items-center justify-center overflow-hidden hover:bg-white/10 transition-colors"
              title="Serverbild ändern"
            >
              {iconImageSrc(server.iconPath) ? (
                <img src={iconImageSrc(server.iconPath)} className="w-full h-full object-cover scale-[1.02]" style={{ imageRendering: "pixelated" }} onLoad={handleIconImgLoad} />
              ) : (
                <Icon icon={iconForServer(server)} className="w-12 h-12 text-white/75" />
              )}
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-3 min-w-0">
                <h2 className="font-minecraft text-white text-4xl truncate">{server.name}</h2>
                <button
                  type="button"
                  onClick={copyEndpoint}
                  className="h-9 max-w-[260px] rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-3 flex items-center gap-2 font-minecraft-ten text-white text-base transition-colors"
                  title="Server-IP kopieren"
                >
                  <span className="truncate">{endpoint}</span>
                  <Icon icon="solar:copy-bold" className="w-4 h-4 text-white/55 shrink-0" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <ServerVersionChip
                  value={server.minecraftVersion}
                  open={openChip === "version"}
                  onToggle={() => setOpenChip(openChip === "version" ? null : "version")}
                  onClose={() => setOpenChip(null)}
                  onSelect={(minecraftVersion) => updateSettings({ minecraftVersion }, "Version")}
                />
                <ServerLoaderChip
                  server={server}
                  open={openChip === "loader"}
                  onToggle={() => setOpenChip(openChip === "loader" ? null : "loader")}
                  onClose={() => setOpenChip(null)}
                  onSelect={(loaderVersion) => updateSettings({ loaderVersion }, "Loader-Version")}
                  onFallbackClick={() => onTabChange("settings")}
                />
                <EditableServerChip icon="solar:cpu-bold" label={`${server.ramMb} MB RAM`} onClick={() => onTabChange("startup")} />
                <EditableServerChip icon="solar:folder-bold" label={contentTitle(primaryKind)} onClick={() => onTabChange("settings")} />
              </div>
            </div>
          </div>
          <div className="flex gap-3 shrink-0">
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => {
                if (server.status === "running") {
                  runAction("Stop", () => LocalServerService.stopServer(server.id), "stop");
                } else {
                  onStartConsole();
                  runAction("Start", () => LocalServerService.startServer(server.id), "start");
                }
              }}
              className={`h-[54px] px-9 rounded-full border font-minecraft text-2xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                server.status === "running"
                  ? "border-white/15 bg-white/10 hover:bg-white/15 text-white"
                  : "border-emerald-300/55 bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-50"
              }`}
            >
              <Icon icon={server.status === "running" ? "solar:stop-bold" : "solar:play-bold"} className="w-5 h-5" />
              {pendingAction === "start" ? "Startet..." : pendingAction === "stop" ? "Stoppt..." : server.status === "running" ? "Stop" : "Spielen"}
            </button>
            <button
              type="button"
              disabled={server.status !== "running" || pendingAction !== null}
              onClick={() => runAction("Restart", () => LocalServerService.restartServer(server.id), "restart")}
              className="h-[50px] px-8 rounded-full border border-orange-300/50 bg-orange-500/20 hover:bg-orange-500/30 font-minecraft text-2xl text-orange-50 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Icon icon="solar:refresh-bold" className={`w-5 h-5 ${pendingAction === "restart" ? "animate-spin" : ""}`} />
              {pendingAction === "restart" ? "Restartet..." : "Restart"}
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              className="h-[54px] w-[54px] rounded-full border border-white/15 bg-white/10 hover:bg-white/15 text-white flex items-center justify-center transition-colors"
              title="Server kopieren"
            >
              <Icon icon="solar:copy-bold" className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="h-[54px] w-[54px] rounded-full border border-red-300/35 bg-red-500/15 hover:bg-red-500/25 text-red-50 flex items-center justify-center transition-colors"
              title="Server löschen"
            >
              <Icon icon="solar:trash-bin-trash-bold" className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => onTabChange("settings")}
              className="h-[54px] w-[54px] rounded-full border border-white/15 bg-white/10 hover:bg-white/15 text-white flex items-center justify-center transition-colors"
              title="Settings"
            >
              <Icon icon="solar:settings-bold" className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "console" && <ConsolePanel server={server} logs={logs} runAction={runAction} />}
          {tab === "files" && <FilesPanel server={server} onUpdate={onUpdate} />}
          {tab === "minecraftProperties" && <MinecraftPropertiesPanel server={server} onUpdate={onUpdate} />}
          {tab === "content" && <ContentLibraryPanel server={server} initialKind={primaryKind} runAction={runAction} onUpdate={onUpdate} />}
          {tab === "backups" && <BackupsPanel server={server} />}
          {tab === "users" && <UsersPanel server={server} onUpdate={onUpdate} />}
          {tab === "database" && <DatabasePanel server={server} onUpdate={onUpdate} />}
          {tab === "startup" && <StartupPanel server={server} onUpdate={onUpdate} />}
          {tab === "settings" && <SettingsPanel server={server} onUpdate={onUpdate} />}
          {tab === "mcp" && <McpPanel server={server} onUpdate={onUpdate} />}
        </div>
      </section>
    </div>
  );
}

function ConsolePanel({
  server,
  logs,
  runAction,
}: {
  server: LocalServer;
  logs: string[];
  runAction: (label: string, action: () => Promise<LocalServer | void>) => Promise<void>;
}) {
  const [command, setCommand] = useState("");
  const [latestLog, setLatestLog] = useState("");

  const sendCommand = async () => {
    if (!command.trim()) return;
    await runAction("Command senden", async () => {
      await LocalServerService.sendCommand(server.id, command.trim());
      setCommand("");
    });
  };

  return (
    <Panel title="Konsole" icon="solar:code-bold">
      <pre className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-black/50 border border-white/10 p-3 text-white/80 font-mono text-xs whitespace-pre-wrap">
        {logs.length ? logs.join("\n") : latestLog || "Noch keine Logs"}
      </pre>
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 mt-3">
        <Input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => event.key === "Enter" && sendCommand()} placeholder="say hallo" />
        <Button onClick={sendCommand}>Senden</Button>
        <Button onClick={async () => setLatestLog(await LocalServerService.readLog(server.id))}>latest.log</Button>
      </div>
    </Panel>
  );
}

function ServerVersionChip({
  value,
  open,
  onToggle,
  onClose,
  onSelect,
}: {
  value: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (version: string) => Promise<void> | void;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [versions, setVersions] = useState<MinecraftVersionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<VersionChannel>("release");

  const fallbackVersions: MinecraftVersionEntry[] = [
    ...fallbackReleaseVersions.map((id) => ({ id, versionType: "release" })),
    ...fallbackSnapshotVersions.map((id) => ({ id, versionType: "snapshot" })),
  ];

  useEffect(() => {
    if (!open || versions.length > 0 || loading) return;
    setLoading(true);
    LocalServerService.listMinecraftVersions()
      .then(setVersions)
      .catch(() => toast.error("Versionen konnten nicht geladen werden. Fallback ist aktiv."))
      .finally(() => setLoading(false));
  }, [open, versions.length, loading]);

  const source = versions.length ? versions : fallbackVersions;
  const filtered = source
    .filter((version) => {
      const type = version.versionType;
      return (channel === "all" || type === channel) && version.id.toLowerCase().includes(query.toLowerCase());
    })
    .slice(0, 80);

  const select = async (version: string) => {
    await onSelect(version);
    onClose();
  };
  const rect = triggerRef.current?.getBoundingClientRect();
  const popoverStyle = rect
    ? { top: Math.round(rect.bottom + 8), left: Math.round(rect.left), zIndex: 2147483647 }
    : { top: 120, left: 120, zIndex: 2147483647 };

  return (
    <div ref={triggerRef} className="relative">
      <EditableServerChip icon="solar:gamepad-bold" label={value} onClick={onToggle} />
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed w-72 border border-white/15 bg-[#11151b]/95 backdrop-blur-md shadow-2xl p-2" style={popoverStyle}>
          <div className="h-9 rounded-lg border border-white/15 bg-black/35 px-3 flex items-center gap-2">
            <Icon icon="solar:magnifer-bold" className="w-4 h-4 text-white/45" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Versionen suchen..."
              className="w-full bg-transparent outline-none font-minecraft-ten text-white placeholder:text-white/40 text-base"
            />
          </div>
          <div className="grid grid-cols-3 gap-1 mt-2">
            {[
              ["release", "Releases"],
              ["snapshot", "Snapshots"],
              ["all", "Alle"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setChannel(id as VersionChannel)}
                className={`h-8 rounded-full font-minecraft-ten text-xs transition-colors ${
                  channel === id ? "bg-white/15 text-white" : "bg-black/25 text-white/55 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-2 max-h-72 overflow-y-auto custom-scrollbar">
            {loading && <div className="p-3 font-minecraft-ten text-white/45 text-base">Lade Versionen...</div>}
            {filtered.map((version) => (
              <button
                key={`${version.id}-${version.versionType}`}
                type="button"
                onClick={() => select(version.id)}
                className={`w-full h-9 px-3 rounded-lg flex items-center justify-between gap-3 font-minecraft-ten text-base transition-colors ${
                  value === version.id ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span>{version.id}</span>
                {value === version.id && <Icon icon="solar:check-circle-bold" className="w-4 h-4 text-white/70" />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ServerLoaderChip({
  server,
  open,
  onToggle,
  onClose,
  onSelect,
  onFallbackClick,
}: {
  server: LocalServer;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (loaderVersion: string) => Promise<void> | void;
  onFallbackClick: () => void;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [versions, setVersions] = useState<LoaderVersionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || !loaderVersionServerType(server.serverType) || versions.length > 0 || loading) return;
    setLoading(true);
    const loaderVersions =
      server.serverType === "fabric"
        ? LocalServerService.listFabricLoaderVersions()
        : server.serverType === "forge"
          ? LocalServerService.listForgeVersions(server.minecraftVersion)
          : LocalServerService.listNeoForgeVersions(server.minecraftVersion);
    loaderVersions
      .then(setVersions)
      .catch(() => toast.error(`${loaderLabel(server.serverType)}-Versionen konnten nicht geladen werden.`))
      .finally(() => setLoading(false));
  }, [open, server.serverType, server.minecraftVersion, versions.length, loading]);

  if (!loaderVersionServerType(server.serverType)) {
    return <EditableServerChip icon="solar:box-bold" label={loaderLabel(server.serverType)} onClick={onFallbackClick} />;
  }

  const current = server.loaderVersion || loaderLabel(server.serverType);
  const filtered = versions
    .filter((version) => version.version.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 80);

  const select = async (loaderVersion: string) => {
    await onSelect(loaderVersion);
    onClose();
  };
  const rect = triggerRef.current?.getBoundingClientRect();
  const popoverStyle = rect
    ? { top: Math.round(rect.bottom + 8), left: Math.round(rect.left), zIndex: 2147483647 }
    : { top: 120, left: 120, zIndex: 2147483647 };

  return (
    <div ref={triggerRef} className="relative">
      <EditableServerChip icon="solar:box-bold" label={current} onClick={onToggle} />
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed w-72 border border-white/15 bg-[#11151b]/95 backdrop-blur-md shadow-2xl p-2" style={popoverStyle}>
          <p className="px-2 pb-2 font-minecraft-ten text-white/50 text-xs uppercase">{loaderLabel(server.serverType)}-Versionen</p>
          <div className="h-9 rounded-lg border border-white/15 bg-black/35 px-3 flex items-center gap-2 mb-2">
            <Icon icon="solar:magnifer-bold" className="w-4 h-4 text-white/45" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Loader suchen..."
              className="w-full bg-transparent outline-none font-minecraft-ten text-white placeholder:text-white/40 text-base"
            />
          </div>
          <div className="max-h-72 overflow-y-auto custom-scrollbar">
            {loading && <div className="p-3 font-minecraft-ten text-white/45 text-base">Lade {loaderLabel(server.serverType)}...</div>}
            {filtered.map((version) => (
              <button
                key={version.version}
                type="button"
                onClick={() => select(version.version)}
                className={`w-full h-9 px-3 rounded-lg flex items-center justify-between gap-3 font-minecraft-ten text-base transition-colors ${
                  server.loaderVersion === version.version ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span>{version.version}</span>
                <span className="flex items-center gap-2">
                  {version.stable && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/55">Stable</span>}
                  {server.loaderVersion === version.version && <Icon icon="solar:check-circle-bold" className="w-4 h-4 text-white/70" />}
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function EditableServerChip({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 max-w-[240px] border border-white/10 bg-white/5 hover:bg-white/10 px-3 rounded-full flex items-center gap-2 font-minecraft-ten text-white/75 text-base transition-colors"
    >
      <Icon icon={icon} className="w-4 h-4 text-white/55 shrink-0" />
      <span className="truncate">{label}</span>
      <Icon icon="solar:pen-bold" className="w-3.5 h-3.5 text-white/35 shrink-0" />
    </button>
  );
}

function FilesPanel({ server, onUpdate }: { server: LocalServer; onUpdate: (server: LocalServer) => void }) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<LocalServerFileEntry[]>([]);
  const [openFile, setOpenFile] = useState<{
    entry: LocalServerFileEntry;
    contents: string;
    dirty: boolean;
  } | null>(null);

  const loadFiles = async (path = currentPath) => {
    const files = await LocalServerService.listFiles(server.id, path);
    setEntries(files);
  };

  useEffect(() => {
    setOpenFile(null);
    setCurrentPath("");
    loadFiles("").catch((error) => toast.error(error.message ?? String(error)));
  }, [server.id]);

  const openEntry = async (entry: LocalServerFileEntry) => {
    if (entry.isDir) {
      setOpenFile(null);
      setCurrentPath(entry.relativePath);
      await loadFiles(entry.relativePath);
      return;
    }
    const contents = await toast.promise(LocalServerService.readFile(server.id, entry.relativePath), {
      loading: "Datei wird geöffnet...",
      success: "Datei geöffnet",
      error: (error) => error.message ?? String(error),
    });
    setOpenFile({ entry, contents, dirty: false });
  };

  const goUp = async () => {
    const parts = currentPath.split("/").filter(Boolean);
    const next = parts.slice(0, -1).join("/");
    setOpenFile(null);
    setCurrentPath(next);
    await loadFiles(next);
  };

  const openCurrentFolder = async () => {
    const path = await LocalServerService.getServerPath(server.id, currentPath);
    await openPath(path);
  };

  const saveOpenFile = async () => {
    if (!openFile) return;
    const updated = await toast.promise(
      LocalServerService.writeFile(server.id, openFile.entry.relativePath, openFile.contents),
      {
        loading: "Datei wird gespeichert...",
        success: "Datei gespeichert",
        error: (error) => error.message ?? String(error),
      },
    );
    onUpdate(updated);
    setOpenFile((current) => current ? { ...current, dirty: false } : current);
    await loadFiles(currentPath);
  };

  const visibleEntries = entries.filter((entry) => {
    if (currentPath) return true;
    return !(isPluginServerType(server.serverType) && entry.isDir && entry.name.toLowerCase() === "mods");
  });

  const newestModified = Math.max(
    0,
    ...visibleEntries
      .map((entry) => entry.modifiedAt ? Date.parse(entry.modifiedAt) : 0)
      .filter((timestamp) => Number.isFinite(timestamp)),
  );

  if (openFile) {
    return (
      <Panel title="Files" icon="solar:folder-bold">
        <div className="flex items-center justify-between gap-3 mb-4">
          <button
            type="button"
            onClick={() => setOpenFile(null)}
            className="border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 font-minecraft-ten text-white/70 text-base flex items-center gap-2"
          >
            <Icon icon="solar:alt-arrow-left-bold" className="w-5 h-5" />
            Zurück zu Files
          </button>
          <div className="flex gap-2">
            <Button size="xs" onClick={() => openPath(openFile.entry.absolutePath)} icon={<Icon icon="solar:folder-open-bold" className="w-4 h-4" />}>Extern öffnen</Button>
            <Button size="xs" disabled={!openFile.dirty} onClick={saveOpenFile} icon={<Icon icon="solar:diskette-bold" className="w-4 h-4" />}>Speichern</Button>
          </div>
        </div>
        <div className="border border-white/10 bg-black/35 p-3 mb-3">
          <p className="font-minecraft text-white text-xl truncate">{openFile.entry.name}</p>
          <p className="font-minecraft-ten text-white/45 text-sm truncate">
            {openFile.entry.relativePath} / Geändert: {formatDateTime(openFile.entry.modifiedAt)} / {formatBytes(openFile.entry.sizeBytes)}
          </p>
        </div>
        <textarea
          value={openFile.contents}
          onChange={(event) => setOpenFile({ ...openFile, contents: event.target.value, dirty: true })}
          spellCheck={false}
          className="flex-1 min-h-0 w-full resize-none bg-black/55 border border-white/10 p-4 text-white/85 font-mono text-sm outline-none custom-scrollbar"
        />
      </Panel>
    );
  }

  return (
    <Panel title="Files" icon="solar:folder-bold">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="font-minecraft-ten text-white/65 text-lg truncate">
          {currentPath || "Server-Ordner"}
        </div>
        <div className="flex gap-2">
          <Button size="xs" onClick={openCurrentFolder} icon={<Icon icon="solar:folder-open-bold" className="w-4 h-4" />}>Öffnen</Button>
        </div>
      </div>
      <div className="space-y-2 overflow-y-auto custom-scrollbar">
        {currentPath && (
          <button
            type="button"
            onClick={goUp}
            className="w-full border border-white/10 bg-black/35 hover:bg-white/10 p-3 min-h-[64px] grid grid-cols-[36px_1fr_auto] gap-3 items-center text-left transition-colors"
          >
            <Icon icon="solar:alt-arrow-left-bold" className="w-6 h-6 text-white/65" />
            <span className="min-w-0">
              <span className="block font-minecraft-ten text-white text-base truncate">Zurück</span>
              <span className="block font-minecraft-ten text-white/40 text-xs truncate">{parentPathLabel(currentPath)}</span>
            </span>
            <span className="font-minecraft-ten text-white/40 text-xs">Ordner</span>
          </button>
        )}
        {visibleEntries.map((entry) => {
          const modifiedTimestamp = entry.modifiedAt ? Date.parse(entry.modifiedAt) : 0;
          const isNewest = newestModified > 0 && modifiedTimestamp === newestModified;
          return (
          <button
            key={entry.relativePath}
            type="button"
            onClick={() => openEntry(entry)}
            className={`w-full border p-3 min-h-[68px] grid grid-cols-[36px_1fr_170px_90px] gap-3 items-center text-left transition-colors ${
              isNewest
                ? "border-orange-300/45 bg-orange-500/15 hover:bg-orange-500/20"
                : "border-white/10 bg-white/5 hover:bg-white/10"
            }`}
          >
            <Icon icon={entry.isDir ? "solar:folder-bold" : "solar:document-bold"} className={`w-6 h-6 ${isNewest ? "text-orange-200" : "text-white/70"}`} />
            <span className="min-w-0">
              <span className="block font-minecraft-ten text-white text-base truncate">{entry.name}</span>
              <span className="block font-minecraft-ten text-white/40 text-xs truncate">{entry.relativePath}</span>
            </span>
            <span className={`font-minecraft-ten text-xs ${isNewest ? "text-orange-100" : "text-white/45"}`}>
              {formatDateTime(entry.modifiedAt)}
            </span>
            <span className="font-minecraft-ten text-white/45 text-xs text-right">{entry.isDir ? "Ordner" : formatBytes(entry.sizeBytes)}</span>
          </button>
          );
        })}
      </div>
    </Panel>
  );
}

function MinecraftPropertiesPanel({ server, onUpdate }: { server: LocalServer; onUpdate: (server: LocalServer) => void }) {
  const [properties, setProperties] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  const load = async () => {
    const next = await LocalServerService.readProperties(server.id);
    setProperties({
      motd: server.name,
      "server-ip": server.serverIp ?? "",
      "server-port": String(server.port),
      "max-players": "20",
      difficulty: "easy",
      gamemode: "survival",
      pvp: "true",
      "online-mode": "true",
      "enable-command-block": "true",
      "allow-flight": "false",
      "view-distance": "10",
      "spawn-protection": "16",
      ...next,
    });
    setDirty(false);
  };

  useEffect(() => {
    load().catch((error) => toast.error(error.message ?? String(error)));
  }, [server.id]);

  const setProperty = (key: string, value: string) => {
    setProperties((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    const updated = await toast.promise(LocalServerService.writeProperties(server.id, properties), {
      loading: "Minecraft Properties werden gespeichert...",
      success: "Minecraft Properties gespeichert",
      error: (error) => error.message ?? String(error),
    });
    setDirty(false);
    onUpdate(updated);
  };

  const rawText = Object.entries(properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const setRawText = (value: string) => {
    const next: Record<string, string> = {};
    for (const line of value.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      next[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
    }
    setProperties(next);
    setDirty(true);
  };

  return (
    <Panel title="Minecraft Properties" icon="solar:document-text-bold">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="font-minecraft text-white text-xl truncate">server.properties</p>
          <p className="font-minecraft-ten text-white/45 text-sm truncate">
            Verständliche Ansicht für die wichtigsten Minecraft-Einstellungen
          </p>
        </div>
        <div className="flex gap-2">
          <RoundMiniButton icon="solar:refresh-bold" label="Neu laden" onClick={load} />
          <RoundMiniButton icon="solar:code-bold" label={rawOpen ? "Einfach" : "Erweitert"} onClick={() => setRawOpen((value) => !value)} />
          <button
            type="button"
            disabled={!dirty}
            onClick={save}
            className="h-8 rounded-full border border-emerald-300/45 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-45 disabled:cursor-not-allowed px-3 flex items-center gap-1.5 font-minecraft-ten text-xs text-emerald-50 transition-colors"
          >
            <Icon icon="solar:diskette-bold" className="w-4 h-4" />
            Speichern
          </button>
        </div>
      </div>

      {rawOpen ? (
        <textarea
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          spellCheck={false}
          className="flex-1 min-h-0 w-full resize-none bg-black/55 border border-white/10 p-4 text-white/85 font-mono text-sm outline-none custom-scrollbar"
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 overflow-y-auto custom-scrollbar pr-1">
          <PropertyText label="Servername / MOTD" value={properties.motd ?? ""} onChange={(value) => setProperty("motd", value)} />
          <PropertyText label="Server-IP" value={properties["server-ip"] ?? ""} onChange={(value) => setProperty("server-ip", value)} placeholder="leer = automatisch" />
          <PropertyText label="Port" type="number" value={properties["server-port"] ?? "25565"} onChange={(value) => setProperty("server-port", value)} />
          <PropertyText label="Max. Spieler" type="number" value={properties["max-players"] ?? "20"} onChange={(value) => setProperty("max-players", value)} />
          <PropertySelect label="Schwierigkeit" value={properties.difficulty ?? "easy"} onChange={(value) => setProperty("difficulty", value)} options={["peaceful", "easy", "normal", "hard"]} />
          <PropertySelect label="Gamemode" value={properties.gamemode ?? "survival"} onChange={(value) => setProperty("gamemode", value)} options={["survival", "creative", "adventure", "spectator"]} />
          <PropertyToggle label="PvP" value={properties.pvp ?? "true"} onChange={(value) => setProperty("pvp", value)} />
          <PropertyToggle label="Online Mode" value={properties["online-mode"] ?? "true"} onChange={(value) => setProperty("online-mode", value)} />
          <PropertyToggle label="Commandblocks" value={properties["enable-command-block"] ?? "true"} onChange={(value) => setProperty("enable-command-block", value)} />
          <PropertyToggle label="Fliegen erlauben" value={properties["allow-flight"] ?? "false"} onChange={(value) => setProperty("allow-flight", value)} />
          <PropertyText label="Sichtweite" type="number" value={properties["view-distance"] ?? "10"} onChange={(value) => setProperty("view-distance", value)} />
          <PropertyText label="Spawn Protection" type="number" value={properties["spawn-protection"] ?? "16"} onChange={(value) => setProperty("spawn-protection", value)} />
        </div>
      )}
    </Panel>
  );
}

function LegacyMinecraftPropertiesPanel({ server, onUpdate }: { server: LocalServer; onUpdate: (server: LocalServer) => void }) {
  const [contents, setContents] = useState("");
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    const next = await LocalServerService.readFile(server.id, "server.properties");
    setContents(next);
    setDirty(false);
  };

  useEffect(() => {
    load().catch((error) => toast.error(error.message ?? String(error)));
  }, [server.id]);

  const save = async () => {
    const updated = await toast.promise(LocalServerService.writeFile(server.id, "server.properties", contents), {
      loading: "server.properties wird gespeichert...",
      success: "server.properties gespeichert",
      error: (error) => error.message ?? String(error),
    });
    setDirty(false);
    onUpdate(updated);
  };

  return (
    <Panel title="Minecraft Properties" icon="solar:document-text-bold">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-minecraft text-white text-xl truncate">server.properties</p>
          <p className="font-minecraft-ten text-white/45 text-sm truncate">
            {loaderLabel(server.serverType)} / {server.minecraftVersion}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="xs" onClick={load} icon={<Icon icon="solar:refresh-bold" className="w-4 h-4" />}>Neu laden</Button>
          <Button size="xs" disabled={!dirty} onClick={save} icon={<Icon icon="solar:diskette-bold" className="w-4 h-4" />}>Speichern</Button>
        </div>
      </div>
      <textarea
        value={contents}
        onChange={(event) => {
          setContents(event.target.value);
          setDirty(true);
        }}
        spellCheck={false}
        className="flex-1 min-h-0 w-full resize-none bg-black/55 border border-white/10 p-4 text-white/85 font-mono text-sm outline-none custom-scrollbar"
      />
    </Panel>
  );
}

function PropertyText({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  placeholder?: string;
}) {
  return (
    <label className="border border-white/10 bg-white/5 p-3 rounded-lg">
      <span className="block font-minecraft-ten text-white/45 text-sm mb-2">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full h-9 rounded-lg border border-white/10 bg-black/35 px-3 outline-none font-minecraft-ten text-white text-base placeholder:text-white/35"
      />
    </label>
  );
}

function PropertySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="border border-white/10 bg-white/5 p-3 rounded-lg">
      <span className="block font-minecraft-ten text-white/45 text-sm mb-2">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-9 rounded-lg border border-white/10 bg-black/35 px-3 outline-none font-minecraft-ten text-white text-base"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function PropertyToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const active = value === "true";
  return (
    <button
      type="button"
      onClick={() => onChange(active ? "false" : "true")}
      className="border border-white/10 bg-white/5 hover:bg-white/10 p-3 rounded-lg flex items-center justify-between gap-3 text-left"
    >
      <span className="font-minecraft-ten text-white text-base">{label}</span>
      <span className={`w-12 h-6 rounded-full border p-0.5 transition-colors ${active ? "border-emerald-300/55 bg-emerald-500/25" : "border-white/15 bg-white/10"}`}>
        <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${active ? "translate-x-5" : "translate-x-0"}`} />
      </span>
    </button>
  );
}

const serverContentKinds: { kind: LocalServerContentKind; label: string; icon: string }[] = [
  { kind: "plugin", label: "Plugins", icon: "solar:plug-circle-bold" },
  { kind: "mod", label: "Mods", icon: "solar:widget-bold" },
  { kind: "modpack", label: "Modpacks", icon: "solar:box-bold" },
  { kind: "resourcepack", label: "Resourcepacks", icon: "solar:palette-bold" },
  { kind: "shaderpack", label: "Shaders", icon: "solar:sun-bold" },
  { kind: "datapack", label: "Datapacks", icon: "solar:database-bold" },
];

function ContentLibraryPanel({
  server,
  initialKind,
  runAction,
  onUpdate,
}: {
  server: LocalServer;
  initialKind: LocalServerContentKind;
  runAction: (label: string, action: () => Promise<LocalServer | void>) => Promise<void>;
  onUpdate: (server: LocalServer) => void;
}) {
  const [activeKind, setActiveKind] = useState<LocalServerContentKind>(
    initialKind,
  );

  useEffect(() => {
    setActiveKind(initialKind);
  }, [server.id, initialKind]);

  return (
    <div className="h-full min-h-0 grid grid-cols-[1fr_220px] gap-4">
      <ContentPanel
        server={server}
        kind={activeKind}
        runAction={runAction}
        onUpdate={onUpdate}
        onKindChange={setActiveKind}
      />
      <aside className="border-2 border-white/10 bg-black/45 backdrop-blur-md p-3 min-h-0">
        <div className="font-minecraft-ten text-white/50 text-sm uppercase mb-3 px-1">Server-Inhalte</div>
        <div className="space-y-2">
          {serverContentKinds.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => setActiveKind(item.kind)}
              className={`w-full h-11 rounded-lg border px-3 flex items-center gap-3 font-minecraft-ten text-base transition-colors ${
                activeKind === item.kind
                  ? "border-white/35 bg-white/15 text-white"
                  : "border-white/10 bg-black/25 text-white/60 hover:text-white hover:bg-white/10"
              }`}
            >
              <Icon icon={item.icon} className="w-5 h-5" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function ContentPanel({
  server,
  kind,
  runAction,
  onUpdate,
  onKindChange,
}: {
  server: LocalServer;
  kind: LocalServerContentKind;
  runAction: (label: string, action: () => Promise<LocalServer | void>) => Promise<void>;
  onUpdate: (server: LocalServer) => void;
  onKindChange: (kind: LocalServerContentKind) => void;
}) {
  const navigate = useNavigate();
  const [filePath, setFilePath] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [results, setResults] = useState<ServerCatalogResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const content = server.installedContent.filter((item) => item.kind === kind);
  const title = contentTitle(kind);
  const importLabel = `${contentSingularTitle(kind)} importieren`;
  const serverLocked =
    server.serverType === "bedrock" ||
    (server.serverType === "vanilla" && ["plugin", "mod", "modpack"].includes(kind)) ||
    (isPluginServerType(server.serverType) && ["mod", "modpack"].includes(kind)) ||
    (isModServerType(server.serverType) && kind === "plugin");
  const selectedItems = content.filter((item) => selected.has(item.fileName));

  useEffect(() => {
    setSelected(new Set());
    setOpenMenuFor(null);
    setResults([]);
    setCatalogQuery("");
  }, [server.id, kind]);

  const chooseFile = async () => {
    const picked = await LocalServerService.pickContentFile(kind);
    if (picked) setFilePath(picked);
  };

  const importFile = async () => {
    if (!filePath.trim()) return;
    await runAction(importLabel, () => LocalServerService.installLocalFile(server.id, filePath.trim(), kind));
    setFilePath("");
  };

  const searchCatalog = async () => {
    const found = await toast.promise(
      LocalServerService.searchCatalog({
        query: catalogQuery,
        kind,
        minecraftVersion: server.minecraftVersion,
        loader: isPluginServerType(server.serverType) ? server.serverType : server.serverType,
      }),
      {
        loading: "Catalog wird durchsucht...",
        success: "Suche fertig",
        error: (error) => error.message ?? String(error),
      },
    );
    setResults(found);
  };

  const toggleSelected = (fileName: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  };

  const selectAll = () => {
    setSelected((current) => current.size === content.length ? new Set() : new Set(content.map((item) => item.fileName)));
  };

  const openContentFolder = async () => {
    const path = await LocalServerService.getServerPath(server.id, contentFolderForKind(kind));
    await openPath(path);
  };

  const setItemEnabled = async (item: InstalledServerContent, enabled: boolean) => {
    await runAction(enabled ? "Aktivieren" : "Deaktivieren", async () => {
      const updated = await LocalServerService.setContentEnabled(server.id, item.fileName, kind, enabled);
      onUpdate(updated);
      return updated;
    });
  };

  const deleteItem = async (item: InstalledServerContent) => {
    await runAction("Löschen", async () => {
      const updated = await LocalServerService.deleteContent(server.id, item.fileName, kind);
      onUpdate(updated);
      setSelected((current) => {
        const next = new Set(current);
        next.delete(item.fileName);
        return next;
      });
      return updated;
    });
  };

  const reinstallItem = async (item: InstalledServerContent) => {
    if (!item.projectId) {
      toast.error("Updates gehen aktuell nur für Modrinth-Inhalte.");
      return;
    }
    await runAction("Fortsetzen", async () => {
      const updated = await LocalServerService.installCatalogProject(server.id, item.projectId!);
      onUpdate(updated);
      return updated;
    });
  };

  const bulkSetEnabled = async (enabled: boolean) => {
    if (!selectedItems.length) return;
    await runAction(enabled ? "Auswahl aktivieren" : "Auswahl deaktivieren", async () => {
      let latest: LocalServer | void;
      for (const item of selectedItems) {
        latest = await LocalServerService.setContentEnabled(server.id, item.fileName, kind, enabled);
      }
      if (latest) onUpdate(latest);
      return latest;
    });
  };

  const bulkDelete = async () => {
    if (!selectedItems.length) return;
    await runAction("Auswahl löschen", async () => {
      let latest: LocalServer | void;
      for (const item of selectedItems) {
        latest = await LocalServerService.deleteContent(server.id, item.fileName, kind);
      }
      setSelected(new Set());
      if (latest) onUpdate(latest);
      return latest;
    });
  };

  const bulkContinue = async () => {
    const modrinthItems = selectedItems.filter((item) => item.projectId);
    if (!modrinthItems.length) {
      toast.error("Keine Modrinth-Inhalte ausgewählt.");
      return;
    }
    await runAction("Auswahl fortsetzen", async () => {
      let latest: LocalServer | void;
      for (const item of modrinthItems) {
        latest = await LocalServerService.installCatalogProject(server.id, item.projectId!);
      }
      if (latest) onUpdate(latest);
      return latest;
    });
  };

  return (
    <Panel title={title} icon={contentIconForKind(kind)}>
      {browserOpen && createPortal(
        <ContentBrowserOverlay
          server={server}
          kind={kind}
          title={title}
          query={catalogQuery}
          results={results}
          serverLocked={serverLocked}
          onQueryChange={setCatalogQuery}
          onKindChange={onKindChange}
          onSearch={searchCatalog}
          onInstall={(projectId) => runAction("Installieren", () => LocalServerService.installCatalogProject(server.id, projectId))}
          onClose={() => setBrowserOpen(false)}
        />,
        document.body,
      )}
      {serverLocked && (
        <div className="mb-4 border border-amber-300/30 bg-amber-500/10 p-3 font-minecraft-ten text-amber-100 text-base">
          Dieser Inhalt passt nicht zu deinem Server-Typ. Nutze Paper für Plugins und Fabric, Forge oder NeoForge für Mods und Modpacks.
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto_auto] gap-3">
        <Input value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder={`${contentSingularTitle(kind)} auswählen oder Pfad einfügen`} />
        <Button disabled={serverLocked} onClick={chooseFile} icon={<Icon icon="solar:folder-bold" className="w-5 h-5" />}>Datei</Button>
        <Button disabled={serverLocked} onClick={importFile} icon={<Icon icon="solar:upload-bold" className="w-5 h-5" />}>Import</Button>
      </div>

      <div className="mt-4 flex justify-end">
        <Button disabled={serverLocked} onClick={() => setBrowserOpen(true)} icon={<Icon icon="solar:magnifer-bold" className="w-5 h-5" />}>
          {title} suchen
        </Button>
      </div>

      <div className="mt-4 border border-white/10 bg-black/25 min-h-0 flex-1 flex flex-col">
        <div className="min-h-[48px] px-3 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={selectAll}
              className={`w-5 h-5 rounded border flex items-center justify-center ${selected.size ? "border-emerald-300 bg-emerald-500/25" : "border-white/20 bg-white/5"}`}
            >
              {selected.size > 0 && <Icon icon="solar:check-bold" className="w-3.5 h-3.5 text-white" />}
            </button>
            <span className="font-minecraft-ten text-white/55 text-base truncate">
              {selected.size ? `${selected.size} ausgewählt` : `${content.length} installiert`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <>
                <RoundMiniButton onClick={() => bulkSetEnabled(true)} icon="solar:play-bold" label="Aktivieren" />
                <RoundMiniButton onClick={() => bulkSetEnabled(false)} icon="solar:pause-bold" label="Deaktivieren" />
                <RoundMiniButton onClick={bulkContinue} icon="solar:refresh-bold" label="Fortsetzen" />
                <RoundMiniButton onClick={bulkDelete} icon="solar:trash-bin-trash-bold" label="Löschen" danger />
              </>
            )}
            <RoundMiniButton onClick={openContentFolder} icon="solar:folder-open-bold" label="Ordner" />
          </div>
        </div>
        <div className="overflow-y-auto custom-scrollbar">
          {content.length === 0 ? (
            <div className="p-6 text-center font-minecraft-ten text-white/45 text-lg">
              Noch keine {title}
            </div>
          ) : content.map((item, index) => {
            const enabled = item.enabled !== false;
            const isSelected = selected.has(item.fileName);
            return (
              <div
                key={`${item.fileName}-${index}`}
                className={`relative min-h-[72px] border-b border-white/10 px-4 py-3 grid grid-cols-[28px_48px_1fr_auto_auto] gap-3 items-center transition-colors ${
                  isSelected ? "bg-white/10" : enabled ? "bg-white/[0.03] hover:bg-white/[0.07]" : "bg-black/25 opacity-70 hover:opacity-100"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSelected(item.fileName)}
                  className={`w-5 h-5 rounded border flex items-center justify-center ${isSelected ? "border-emerald-300 bg-emerald-500/25" : "border-white/20 bg-white/5"}`}
                >
                  {isSelected && <Icon icon="solar:check-bold" className="w-3.5 h-3.5 text-white" />}
                </button>
                <div className="w-12 h-12 rounded-md border border-white/10 bg-black/35 flex items-center justify-center overflow-hidden">
                  <Icon icon={contentIconForKind(kind)} className="w-6 h-6 text-white/65" />
                </div>
                <div className="min-w-0">
                  <p className="font-minecraft-ten text-white text-base truncate">{item.name || item.fileName}</p>
                  <p className="font-minecraft-ten text-white/45 text-sm truncate">
                    {item.source} / {item.version || "local"} / {enabled ? "Aktiv" : "Deaktiviert"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setItemEnabled(item, !enabled)}
                  className={`w-12 h-6 rounded-full border p-0.5 transition-colors ${enabled ? "border-emerald-300/55 bg-emerald-500/25" : "border-white/15 bg-white/10"}`}
                  title={enabled ? "Deaktivieren" : "Aktivieren"}
                >
                  <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpenMenuFor(openMenuFor === item.fileName ? null : item.fileName)}
                  className="w-9 h-9 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/70"
                >
                  <Icon icon="solar:menu-dots-bold" className="w-5 h-5" />
                </button>
                {openMenuFor === item.fileName && (
                  <div className="absolute right-4 top-14 z-40 w-52 border border-white/15 bg-[#10141a] shadow-xl p-2">
                    <ContentMenuButton icon="solar:folder-open-bold" label="Ordner öffnen" onClick={() => { setOpenMenuFor(null); openContentFolder(); }} />
                    {item.projectId && (
                      <ContentMenuButton icon="solar:gamepad-bold" label="Im Client öffnen" onClick={() => { setOpenMenuFor(null); navigate(`/mods/modrinth/${item.projectId}`); }} />
                    )}
                    <ContentMenuButton icon="solar:refresh-bold" label="Updates checken" onClick={() => { setOpenMenuFor(null); toast.success(item.projectId ? "Modrinth-Update bereit zum Fortsetzen." : "Lokale Dateien haben keinen Update-Check."); }} />
                    <ContentMenuButton icon="solar:download-bold" label="Fortsetzen" onClick={() => { setOpenMenuFor(null); reinstallItem(item); }} />
                    <ContentMenuButton icon="solar:trash-bin-trash-bold" label="Löschen" danger onClick={() => { setOpenMenuFor(null); deleteItem(item); }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function ContentBrowserOverlay({
  server,
  kind,
  title,
  query,
  results,
  serverLocked,
  onQueryChange,
  onKindChange,
  onSearch,
  onInstall,
  onClose,
}: {
  server: LocalServer;
  kind: LocalServerContentKind;
  title: string;
  query: string;
  results: ServerCatalogResult[];
  serverLocked: boolean;
  onQueryChange: (value: string) => void;
  onKindChange: (kind: LocalServerContentKind) => void;
  onSearch: () => void;
  onInstall: (projectId: string) => void;
  onClose: () => void;
}) {
  const browseKinds = serverContentKinds.filter((item) => item.kind !== "plugin" || isPluginServer(server));

  return (
    <div className="fixed inset-0 z-[2147483647] bg-black/70 backdrop-blur-md p-8">
      <div className="h-full border-2 border-white/10 bg-[#080b10]/95 shadow-2xl grid grid-cols-[1fr_240px] overflow-hidden">
        <main className="min-w-0 min-h-0 flex flex-col p-5">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="min-w-0">
              <p className="font-minecraft-ten text-white/45 text-sm uppercase">Inhalte hinzufügen / {server.name}</p>
              <h2 className="font-minecraft text-white text-3xl truncate">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-4 font-minecraft-ten text-white/70 text-base"
            >
              Schließen
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {browseKinds.map((item) => (
              <button
                key={item.kind}
                type="button"
                onClick={() => onKindChange(item.kind)}
                className={`h-11 rounded-lg border px-4 flex items-center gap-2 font-minecraft-ten text-base transition-colors ${
                  kind === item.kind ? "border-white/45 bg-white/15 text-white" : "border-white/10 bg-black/35 text-white/65 hover:text-white hover:bg-white/10"
                }`}
              >
                <Icon icon={item.icon} className="w-5 h-5" />
                {item.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3 mb-4">
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && onSearch()}
              placeholder={`${title} durchsuchen...`}
            />
            <Button disabled={serverLocked} onClick={onSearch} icon={<Icon icon="solar:magnifer-bold" className="w-5 h-5" />}>Suchen</Button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-2 pr-2">
            {serverLocked ? (
              <div className="border border-amber-300/30 bg-amber-500/10 p-5 font-minecraft-ten text-amber-100 text-lg">
                Dieser Inhalt passt nicht zu deinem Server-Typ.
              </div>
            ) : results.length === 0 ? (
              <div className="border border-white/10 bg-white/5 p-8 text-center font-minecraft-ten text-white/45 text-lg">
                Suche nach {title}, um Inhalte zu installieren.
              </div>
            ) : results.map((result) => (
              <article key={result.projectId} className="border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] p-3 grid grid-cols-[64px_1fr_auto] gap-4 items-center">
                {result.iconUrl ? (
                  <img src={result.iconUrl} className="w-16 h-16 object-cover rounded-md" />
                ) : (
                  <div className="w-16 h-16 rounded-md border border-white/10 bg-black/35 flex items-center justify-center">
                    <Icon icon={contentIconForKind(kind)} className="w-8 h-8 text-white/70" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="font-minecraft text-white text-xl truncate">{result.title}</h3>
                    <span className="font-minecraft-ten text-white/35 text-xs truncate">Modrinth</span>
                  </div>
                  <p className="font-minecraft-ten text-white/55 text-base truncate">{result.description}</p>
                  <p className="font-minecraft-ten text-white/35 text-xs">{result.downloads.toLocaleString()} Downloads</p>
                </div>
                <button
                  type="button"
                  onClick={() => onInstall(result.projectId)}
                  className="h-10 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 px-4 flex items-center gap-2 font-minecraft-ten text-white text-base"
                >
                  <Icon icon="solar:download-bold" className="w-4 h-4" />
                  Install
                </button>
              </article>
            ))}
          </div>
        </main>
        <aside className="border-l border-white/10 bg-black/30 p-4 min-h-0 overflow-y-auto custom-scrollbar">
          <FilterBlock title="Spielversion">
            <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 font-minecraft-ten text-white text-base">
              {server.minecraftVersion}
            </div>
          </FilterBlock>
          <FilterBlock title="Quelle">
            <div className="grid grid-cols-1 gap-2">
              <button className="h-10 rounded-lg border border-emerald-300/40 bg-emerald-500/15 font-minecraft-ten text-emerald-50 text-sm">Modrinth</button>
              <button disabled className="h-10 rounded-lg border border-white/10 bg-white/5 font-minecraft-ten text-white/35 text-sm">CurseForge</button>
            </div>
          </FilterBlock>
          <FilterBlock title="Loader">
            <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 font-minecraft-ten text-white text-base">
              {loaderLabel(server.serverType)}
            </div>
          </FilterBlock>
        </aside>
      </div>
    </div>
  );
}

function FilterBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="font-minecraft-ten text-white/70 text-sm uppercase mb-2">{title}</h3>
      {children}
    </section>
  );
}

function LegacyContentPanel({
  server,
  kind,
  runAction,
}: {
  server: LocalServer;
  kind: LocalServerContentKind;
  runAction: (label: string, action: () => Promise<LocalServer | void>) => Promise<void>;
}) {
  const [filePath, setFilePath] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [results, setResults] = useState<ServerCatalogResult[]>([]);
  const content = server.installedContent.filter((item) => item.kind === kind);
  const title = kind === "plugin" ? "Plugins" : kind === "mod" ? "Mods" : "Resourcepacks";
  const importLabel = kind === "resourcepack" ? "Resourcepack importieren" : "Datei importieren";
  const vanillaLocked = server.serverType === "vanilla" && kind !== "resourcepack";
  const bedrockLocked = server.serverType === "bedrock";

  const chooseFile = async () => {
    const picked = await LocalServerService.pickContentFile(kind);
    if (picked) setFilePath(picked);
  };

  const importFile = async () => {
    if (!filePath.trim()) return;
    await runAction(importLabel, () => LocalServerService.installLocalFile(server.id, filePath.trim(), kind));
    setFilePath("");
  };

  const searchCatalog = async () => {
    const found = await toast.promise(
      LocalServerService.searchCatalog({
        query: catalogQuery,
        kind,
        minecraftVersion: server.minecraftVersion,
        loader: isPluginServerType(server.serverType) ? server.serverType : server.serverType,
      }),
      {
        loading: "Catalog wird durchsucht...",
        success: "Suche fertig",
        error: (error) => error.message ?? String(error),
      },
    );
    setResults(found);
  };

  return (
    <Panel title={title} icon={kind === "resourcepack" ? "solar:palette-bold" : "solar:widget-bold"}>
      {(vanillaLocked || bedrockLocked) && (
        <div className="mb-4 border border-amber-300/30 bg-amber-500/10 p-3 font-minecraft-ten text-amber-100 text-base">
          {bedrockLocked
            ? "Bedrock nutzt Add-ons anders als Java. Dieser Bereich wird separat verbunden."
            : "Vanilla lädt keine Plugins oder Mods. Wähle Paper für Plugins und Fabric, Forge oder NeoForge für Mods."}
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto_auto] gap-3">
        <Input value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder={kind === "resourcepack" ? "Resourcepack-ZIP auswählen oder Pfad einfügen" : "Datei auswählen oder Pfad einfügen"} />
        <Button disabled={vanillaLocked || bedrockLocked} onClick={chooseFile} icon={<Icon icon="solar:folder-bold" className="w-5 h-5" />}>Datei</Button>
        <Button disabled={vanillaLocked || bedrockLocked} onClick={importFile} icon={<Icon icon="solar:upload-bold" className="w-5 h-5" />}>Import</Button>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3 mt-4">
        <Input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder={`${title} durchsuchen`} />
        <Button disabled={vanillaLocked || bedrockLocked} onClick={searchCatalog} icon={<Icon icon="solar:magnifer-bold" className="w-5 h-5" />}>Suchen</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4 overflow-y-auto custom-scrollbar">
        {results.map((result) => (
          <article key={result.projectId} className="border border-white/10 bg-white/5 p-3 grid grid-cols-[42px_1fr_auto] gap-3 items-center">
            {result.iconUrl ? <img src={result.iconUrl} className="w-10 h-10 object-cover" /> : <Icon icon="solar:widget-bold" className="w-10 h-10 text-white/70" />}
            <div className="min-w-0">
              <strong className="block font-minecraft-ten text-white text-base truncate">{result.title}</strong>
              <p className="font-minecraft-ten text-white/50 text-sm truncate">{result.description}</p>
            </div>
            <Button size="xs" onClick={() => runAction("Installieren", () => LocalServerService.installCatalogProject(server.id, result.projectId))}>
              Install
            </Button>
          </article>
        ))}
      </div>

      <div className="mt-4 space-y-2 overflow-y-auto custom-scrollbar">
        {content.map((item, index) => (
          <div key={`${item.fileName}-${index}`} className="border border-white/10 bg-white/5 p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-minecraft-ten text-white text-base truncate">{item.fileName}</p>
              <p className="font-minecraft-ten text-white/50 text-sm">{item.source} / {item.version || "local"}</p>
            </div>
            <span className="font-minecraft-ten text-white/45 text-sm">{server.autoUpdateContent ? "Auto Update" : "Manuell"}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RoundMiniButton({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-full border px-3 flex items-center gap-1.5 font-minecraft-ten text-xs transition-colors ${
        danger
          ? "border-red-300/35 bg-red-500/15 text-red-100 hover:bg-red-500/25"
          : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
      }`}
    >
      <Icon icon={icon} className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}

function ContentMenuButton({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full h-9 rounded-lg px-3 flex items-center gap-2 font-minecraft-ten text-sm text-left transition-colors ${
        danger ? "text-red-200 hover:bg-red-500/15" : "text-white/70 hover:text-white hover:bg-white/10"
      }`}
    >
      <Icon icon={icon} className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}

function primaryContentKind(server: LocalServer): LocalServerContentKind {
  if (isPluginServer(server)) return "plugin";
  if (isModpackServer(server)) return "modpack";
  return "mod";
}

function contentTitle(kind: LocalServerContentKind) {
  switch (kind) {
    case "plugin":
      return "Plugins";
    case "mod":
      return "Mods";
    case "resourcepack":
      return "Resourcepacks";
    case "modpack":
      return "Modpacks";
    case "shaderpack":
      return "Shaders";
    case "datapack":
      return "Datapacks";
    default:
      return "Inhalte";
  }
}

function contentSingularTitle(kind: LocalServerContentKind) {
  switch (kind) {
    case "plugin":
      return "Plugin";
    case "mod":
      return "Mod";
    case "resourcepack":
      return "Resourcepack";
    case "modpack":
      return "Modpack";
    case "shaderpack":
      return "Shaderpack";
    case "datapack":
      return "Datapack";
    default:
      return "Datei";
  }
}

function contentIconForKind(kind: LocalServerContentKind) {
  switch (kind) {
    case "resourcepack":
      return "solar:palette-bold";
    case "modpack":
      return "solar:box-bold";
    case "shaderpack":
      return "solar:sun-bold";
    case "datapack":
      return "solar:database-bold";
    case "plugin":
      return "solar:plug-circle-bold";
    default:
      return "solar:widget-bold";
  }
}

function contentFolderForKind(kind: LocalServerContentKind) {
  switch (kind) {
    case "plugin":
      return "plugins";
    case "mod":
      return "mods";
    case "resourcepack":
      return "resourcepacks";
    case "modpack":
      return "modpacks";
    case "shaderpack":
      return "shaderpacks";
    case "datapack":
      return "datapacks";
    default:
      return "";
  }
}

function BackupsPanel({ server }: { server: LocalServer }) {
  const [backups, setBackups] = useState<ServerBackup[]>([]);

  const loadBackups = async () => {
    setBackups(await LocalServerService.listBackups(server.id));
  };

  useEffect(() => {
    loadBackups().catch((error) => toast.error(error.message ?? String(error)));
  }, [server.id]);

  const createBackup = async () => {
    const backup = await toast.promise(LocalServerService.createBackup(server.id), {
      loading: "Backup wird erstellt...",
      success: "Backup erstellt",
      error: (error) => error.message ?? String(error),
    });
    setBackups((current) => [backup, ...current]);
  };

  return (
    <Panel title="Backups" icon="solar:archive-bold">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="font-minecraft-ten text-white/60 text-lg">Manuelle Server-Snapshots</p>
        <Button onClick={createBackup} icon={<Icon icon="solar:archive-up-bold" className="w-5 h-5" />}>Backup erstellen</Button>
      </div>
      <div className="space-y-2 overflow-y-auto custom-scrollbar">
        {backups.length === 0 ? (
          <div className="border border-white/10 bg-black/35 p-6 text-center font-minecraft-ten text-white/50 text-lg">
            Noch keine Backups
          </div>
        ) : backups.map((backup) => (
          <button
            key={backup.path}
            type="button"
            onClick={() => openPath(backup.path)}
            className="w-full border border-white/10 bg-white/5 hover:bg-white/10 p-3 flex items-center justify-between gap-3 text-left"
          >
            <span className="min-w-0">
              <span className="block font-minecraft-ten text-white text-base truncate">{backup.name}</span>
              <span className="block font-minecraft-ten text-white/45 text-xs">{new Date(backup.createdAt).toLocaleString()}</span>
            </span>
            <Icon icon="solar:folder-open-bold" className="w-5 h-5 text-white/60" />
          </button>
        ))}
      </div>
    </Panel>
  );
}

function UsersPanel({ server, onUpdate }: { server: LocalServer; onUpdate: (server: LocalServer) => void }) {
  const [name, setName] = useState("");
  const { friends, loadFriends, openSidebar } = useFriendsStore();
  const users = server.invitedUsers ?? [];

  useEffect(() => {
    loadFriends().catch((error) => toast.error(String(error)));
  }, [loadFriends]);

  const invite = async () => {
    if (!name.trim()) return;
    const updated = await toast.promise(LocalServerService.inviteUser(server.id, name.trim()), {
      loading: "User wird eingeladen...",
      success: "User eingeladen",
      error: (error) => error.message ?? String(error),
    });
    setName("");
    onUpdate(updated);
  };

  return (
    <Panel title="Users" icon="solar:users-group-rounded-bold">
      <div className="grid grid-cols-[1fr_auto] gap-3 mb-4">
        <Input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && invite()} placeholder="Freund oder Spielername" />
        <Button onClick={invite} icon={<Icon icon="solar:user-plus-bold" className="w-5 h-5" />}>Einladen</Button>
      </div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="font-minecraft-ten text-white/55 text-base">Freunde</p>
        <Button size="xs" onClick={openSidebar} icon={<Icon icon="solar:users-group-rounded-bold" className="w-4 h-4" />}>Freundesliste öffnen</Button>
      </div>
      {friends.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-4 max-h-[172px] overflow-y-auto custom-scrollbar">
          {friends.map((friend) => {
            const invited = users.some((user) => user.name.toLowerCase() === friend.username.toLowerCase());
            return (
              <button
                key={friend.uuid}
                type="button"
                disabled={invited}
                onClick={async () => {
                  setName(friend.username);
                  const updated = await toast.promise(LocalServerService.inviteUser(server.id, friend.username), {
                    loading: "Freund wird eingeladen...",
                    success: "Freund eingeladen",
                    error: (error) => error.message ?? String(error),
                  });
                  onUpdate(updated);
                }}
                className={`border p-3 flex items-center justify-between gap-3 text-left disabled:opacity-50 ${
                  invited ? "border-emerald-300/35 bg-emerald-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-minecraft-ten text-white text-base truncate">{friend.username}</span>
                  <span className="block font-minecraft-ten text-white/45 text-xs">{friend.state}</span>
                </span>
                <Icon icon={invited ? "solar:check-circle-bold" : "solar:user-plus-bold"} className="w-5 h-5 text-white/60" />
              </button>
            );
          })}
        </div>
      )}
      <div className="space-y-2 overflow-y-auto custom-scrollbar">
        {users.length === 0 ? (
          <div className="border border-white/10 bg-black/35 p-6 text-center font-minecraft-ten text-white/50 text-lg">
            Noch keine User eingeladen
          </div>
        ) : users.map((user) => (
          <div key={user.name} className="border border-white/10 bg-white/5 p-3 flex items-center justify-between gap-3">
            <span className="font-minecraft-ten text-white text-base">{user.name}</span>
            <span className="font-minecraft-ten text-white/45 text-sm">{user.role}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DatabasePanel({ server, onUpdate }: { server: LocalServer; onUpdate: (server: LocalServer) => void }) {
  const [databaseName, setDatabaseName] = useState(server.database?.name ?? "server.sqlite");
  const database = server.database;

  const createDatabase = async () => {
    const updated = await toast.promise(LocalServerService.createDatabase(server.id, databaseName), {
      loading: "Database wird erstellt...",
      success: "Database erstellt",
      error: (error) => error.message ?? String(error),
    });
    onUpdate(updated);
  };

  return (
    <Panel title="Database" icon="solar:database-bold">
      <div className="grid grid-cols-[1fr_auto] gap-3 mb-4">
        <Input value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} placeholder="server.sqlite" />
        <Button onClick={createDatabase} icon={<Icon icon="solar:database-bold" className="w-5 h-5" />}>SQLite erstellen</Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <InfoRow label="Status" value={database?.enabled ? "Aktiv" : "Nicht eingerichtet"} />
        <InfoRow label="Typ" value={database?.databaseType ?? "SQLite"} />
        <InfoRow label="Name" value={database?.name ?? "server.sqlite"} />
        <InfoRow label="Pfad" value={database?.path ?? "Noch nicht erstellt"} />
      </div>
      {database?.path && (
        <div className="flex justify-end mt-4">
          <Button onClick={() => database.path && openPath(database.path)} icon={<Icon icon="solar:folder-open-bold" className="w-5 h-5" />}>Database öffnen</Button>
        </div>
      )}
    </Panel>
  );
}

function StartupPanel({ server, onUpdate }: { server: LocalServer; onUpdate: (server: LocalServer) => void }) {
  const [settings, setSettings] = useState<UpdateLocalServerSettingsInput>({
    ramMb: server.ramMb,
    javaPath: server.javaPath ?? "",
    autoUpdateContent: server.autoUpdateContent ?? true,
  });

  const save = async () => {
    const updated = await toast.promise(LocalServerService.updateSettings(server.id, settings), {
      loading: "Startup wird gespeichert...",
      success: "Startup gespeichert",
      error: (error) => error.message ?? String(error),
    });
    onUpdate(updated);
  };

  return (
    <Panel title="Startup" icon="solar:rocket-bold">
      <div className="grid grid-cols-2 gap-3">
        <Input type="number" value={settings.ramMb ?? 4096} onChange={(event) => setSettings({ ...settings, ramMb: Number(event.target.value) })} placeholder="Arbeitsspeicher MB" />
        <Input value={settings.javaPath ?? ""} onChange={(event) => setSettings({ ...settings, javaPath: event.target.value })} placeholder="Java.exe optional" />
      </div>
      <input
        type="range"
        min={1024}
        max={16384}
        step={512}
        value={settings.ramMb ?? 4096}
        onChange={(event) => setSettings({ ...settings, ramMb: Number(event.target.value) })}
        className="w-full accent-emerald-400 mt-4"
      />
      <div className="grid grid-cols-2 gap-3 mt-4">
        <InfoRow label="Startbefehl" value={`java -Xmx${settings.ramMb ?? server.ramMb}M -jar server.jar nogui`} />
        <InfoRow label="Serverstatus" value={statusLabel(server.status)} />
      </div>
      <div className="mt-4">
        <ToggleRow
          icon="solar:refresh-bold"
          title="Plugins automatisch updaten"
          active={Boolean(settings.autoUpdateContent)}
          onClick={() => setSettings({ ...settings, autoUpdateContent: !settings.autoUpdateContent })}
        />
      </div>
      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={save}
          className="h-10 rounded-full border border-emerald-300/45 bg-emerald-500/20 hover:bg-emerald-500/30 px-5 flex items-center gap-2 font-minecraft-ten text-emerald-50 text-base transition-colors"
        >
          <Icon icon="solar:diskette-bold" className="w-5 h-5" />
          Speichern
        </button>
      </div>
    </Panel>
  );
}

function McpPanel({ server, onUpdate }: { server: LocalServer; onUpdate: (server: LocalServer) => void }) {
  const [settings, setSettings] = useState<UpdateLocalServerSettingsInput>({
    codexEnabled: server.codexEnabled ?? false,
    codexMcpPort: server.codexMcpPort ?? 8765,
  });

  const save = async () => {
    const updated = await toast.promise(LocalServerService.updateSettings(server.id, settings), {
      loading: "MCP wird gespeichert...",
      success: "MCP gespeichert",
      error: (error) => error.message ?? String(error),
    });
    onUpdate(updated);
  };

  return (
    <Panel title="MCP" icon="solar:code-square-bold">
      <div className="space-y-3">
        <ToggleRow
          icon="solar:code-bold"
          title="Mit Codex verknüpfen"
          active={Boolean(settings.codexEnabled)}
          onClick={() => setSettings({ ...settings, codexEnabled: !settings.codexEnabled })}
        />
        <Input type="number" value={settings.codexMcpPort ?? 8765} onChange={(event) => setSettings({ ...settings, codexMcpPort: Number(event.target.value) })} placeholder="MCP-Port" />
        <div className="grid grid-cols-2 gap-3">
          <InfoRow label="Status" value={settings.codexEnabled ? "Aktiv" : "Aus"} />
          <InfoRow label="Server-ID" value={server.id} />
        </div>
      </div>
      <div className="flex justify-end mt-4">
        <Button onClick={save} icon={<Icon icon="solar:diskette-bold" className="w-5 h-5" />}>Speichern</Button>
      </div>
    </Panel>
  );
}

function SettingsPanel({ server, onUpdate }: { server: LocalServer; onUpdate: (server: LocalServer) => void }) {
  const [settings, setSettings] = useState<UpdateLocalServerSettingsInput>({
    name: server.name,
    description: server.description ?? "",
    iconPath: server.iconPath ?? "",
    serverType: server.serverType,
    minecraftVersion: server.minecraftVersion,
    loaderVersion: server.loaderVersion ?? "",
    serverIp: server.serverIp ?? "",
    port: server.port,
    ramMb: server.ramMb,
    javaPath: server.javaPath ?? "",
    serverKind: server.serverKind ?? (isPluginServer(server) ? "plugins" : "modpack"),
    codexEnabled: server.codexEnabled ?? false,
    codexMcpPort: server.codexMcpPort ?? 8765,
    autoUpdateContent: server.autoUpdateContent ?? true,
  });
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [openSettingsChip, setOpenSettingsChip] = useState<"version" | "loader" | null>(null);

  const save = async () => {
    const updated = await toast.promise(LocalServerService.updateSettings(server.id, settings), {
      loading: "Settings werden gespeichert...",
      success: "Settings gespeichert",
      error: (error) => error.message ?? String(error),
    });
    onUpdate(updated);
  };

  return (
    <Panel title="Settings" icon="solar:settings-bold">
      {showIconPicker && (
        <IconPicker
          selected={chosenIconFromValue(settings.iconPath)}
          onSelect={(icon) => setSettings({ ...settings, iconPath: valueFromChosenIcon(icon) })}
          onClose={() => setShowIconPicker(false)}
        />
      )}
      <div className="grid grid-cols-[180px_1fr] gap-5 min-h-0">
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowIconPicker(true)}
            className="w-full aspect-square border-2 border-white/15 bg-black/35 flex items-center justify-center overflow-hidden hover:bg-white/10 transition-colors"
          >
            {iconImageSrc(settings.iconPath) ? (
              <img src={iconImageSrc(settings.iconPath)} className="w-full h-full object-cover scale-[1.02]" style={{ imageRendering: "pixelated" }} onLoad={handleIconImgLoad} />
            ) : (
              <Icon icon={iconForServer(server)} className="w-14 h-14 text-white/75" />
            )}
          </button>
          <InfoRow label="Status" value={statusLabel(server.status)} />
          <InfoRow label="Typ" value={loaderLabel(server.serverType)} />
        </div>
        <div className="space-y-3 overflow-y-auto custom-scrollbar pr-1">
          <div className="grid grid-cols-2 gap-3">
            <Input value={settings.name ?? ""} onChange={(event) => setSettings({ ...settings, name: event.target.value })} placeholder="Name" />
            <Input value={settings.serverIp ?? ""} onChange={(event) => setSettings({ ...settings, serverIp: event.target.value })} placeholder="Server-IP" />
            <Select
              value={settings.serverType ?? server.serverType}
              onChange={(value) => setSettings({
                ...settings,
                serverType: value as LocalServer["serverType"],
                serverKind: kindForServerType(value as LocalServer["serverType"]),
                loaderVersion: loaderVersionServerType(value as LocalServer["serverType"]) ? settings.loaderVersion : "",
              })}
            >
              <option value="paper">Paper</option>
              <option value="spigot">Spigot</option>
              <option value="bukkit">Bukkit</option>
              <option value="fabric">Fabric</option>
              <option value="forge">Forge</option>
              <option value="neoforge">NeoForge</option>
              <option value="vanilla">Vanilla</option>
              <option value="bedrock">Bedrock</option>
            </Select>
            <SettingsChipField label="Minecraft-Version">
              <ServerVersionChip
                value={settings.minecraftVersion ?? server.minecraftVersion}
                open={openSettingsChip === "version"}
                onToggle={() => setOpenSettingsChip(openSettingsChip === "version" ? null : "version")}
                onClose={() => setOpenSettingsChip(null)}
                onSelect={(minecraftVersion) => setSettings({ ...settings, minecraftVersion })}
              />
            </SettingsChipField>
            <SettingsChipField label="Loader-Version">
              <ServerLoaderChip
                server={{
                  ...server,
                  serverType: settings.serverType ?? server.serverType,
                  loaderVersion: settings.loaderVersion ?? server.loaderVersion,
                  minecraftVersion: settings.minecraftVersion ?? server.minecraftVersion,
                }}
                open={openSettingsChip === "loader"}
                onToggle={() => setOpenSettingsChip(openSettingsChip === "loader" ? null : "loader")}
                onClose={() => setOpenSettingsChip(null)}
                onSelect={(loaderVersion) => setSettings({ ...settings, loaderVersion })}
                onFallbackClick={() => toast("Nur Fabric, Forge und NeoForge haben eine Loader-Version.")}
              />
            </SettingsChipField>
            <Input type="number" value={settings.port ?? 25565} onChange={(event) => setSettings({ ...settings, port: Number(event.target.value) })} placeholder="Port" />
            <Input type="number" value={settings.ramMb ?? 4096} onChange={(event) => setSettings({ ...settings, ramMb: Number(event.target.value) })} placeholder="Arbeitsspeicher MB" />
          </div>
          <SearchStyleTextArea
            value={settings.description ?? ""}
            onChange={(event) => setSettings({ ...settings, description: event.target.value })}
            placeholder="Notizen"
            minHeight="86px"
          />
          <Input value={settings.javaPath ?? ""} onChange={(event) => setSettings({ ...settings, javaPath: event.target.value })} placeholder="Java.exe optional" />
          <div className="grid grid-cols-3 gap-3">
            <Select value={settings.serverKind ?? "plugins"} onChange={(value) => setSettings({ ...settings, serverKind: value as LocalServerKind })}>
              <option value="plugins">Mit Plugins</option>
              <option value="modpack">Mit Modpack</option>
              <option value="vanilla">Vanilla</option>
              <option value="bedrock">Bedrock</option>
            </Select>
            <ToggleRow
              icon="solar:code-bold"
              title="Codex"
              active={Boolean(settings.codexEnabled)}
              onClick={() => setSettings({ ...settings, codexEnabled: !settings.codexEnabled })}
            />
            <ToggleRow
              icon="solar:refresh-bold"
              title="Auto Update"
              active={Boolean(settings.autoUpdateContent)}
              onClick={() => setSettings({ ...settings, autoUpdateContent: !settings.autoUpdateContent })}
            />
          </div>
          <Input type="number" value={settings.codexMcpPort ?? 8765} onChange={(event) => setSettings({ ...settings, codexMcpPort: Number(event.target.value) })} placeholder="Codex MCP-Port" />
        </div>
      </div>
      <div className="flex justify-end mt-4">
        <Button onClick={save} icon={<Icon icon="solar:diskette-bold" className="w-5 h-5" />}>Speichern</Button>
      </div>
    </Panel>
  );
}

function SettingsChipField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="h-[50px] border border-white/15 bg-black/50 px-3 flex items-center justify-between gap-3">
      <span className="font-minecraft-ten text-white/45 text-sm truncate">{label}</span>
      <div className="min-w-0 flex justify-end">{children}</div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <section className="h-full min-h-0 border-2 border-white/10 bg-black/45 backdrop-blur-md p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <Icon icon={icon} className="w-5 h-5 text-white" />
        <h3 className="font-minecraft text-white text-lg">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-white/5 p-3 min-w-0">
      <p className="font-minecraft-ten text-white/45 text-sm">{label}</p>
      <p className="font-minecraft-ten text-white text-base truncate">{value}</p>
    </div>
  );
}

function ToggleRow({
  icon,
  title,
  active,
  onClick,
}: {
  icon: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[50px] px-4 border rounded-full flex items-center justify-between gap-3 font-minecraft-ten text-lg ${
        active ? "bg-emerald-500/20 border-emerald-300/50 text-white" : "bg-black/40 border-white/10 text-white/60"
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Icon icon={icon} className="w-5 h-5" />
        <span className="truncate">{title}</span>
      </span>
      <span className={`w-11 h-6 rounded-full border p-0.5 ${active ? "bg-emerald-400/80 border-emerald-200" : "bg-white/10 border-white/20"}`}>
        <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${active ? "translate-x-5" : "translate-x-0"}`} />
      </span>
    </button>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      className="h-[50px] bg-black/50 border border-white/15 px-3 text-white font-minecraft-ten outline-none"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

function ModalFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto custom-scrollbar border-2 border-white/15 bg-[#080b10] p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 className="font-minecraft text-white text-2xl">{title}</h2>
          <button type="button" className="text-white/60 hover:text-white" onClick={onClose}>
            <Icon icon="solar:close-circle-bold" className="w-7 h-7" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CreatingOverlay() {
  return (
    <div className="absolute right-6 bottom-6 z-40 pointer-events-none border-2 border-white/15 bg-black/75 backdrop-blur-md px-5 py-4 flex items-center gap-4 shadow-2xl">
      <div className="w-10 h-10 border-4 border-white/15 border-t-emerald-300 rounded-full animate-spin" />
      <p className="font-minecraft text-white text-xl">Server wird erstellt</p>
    </div>
  );
}

function iconImageSrc(value?: string | null) {
  if (!value || value.startsWith("preset:")) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return convertFileSrc(value);
}

function chosenIconFromValue(value?: string | null): ChosenIcon | null {
  if (!value || value.startsWith("preset:")) return null;
  if (/^https?:\/\//i.test(value)) return { url: value };
  return { path: value };
}

function valueFromChosenIcon(icon: ChosenIcon) {
  return "url" in icon ? icon.url : icon.path;
}

function formatBytes(size: number) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function parentPathLabel(path: string) {
  const parts = path.split("/").filter(Boolean);
  const parent = parts.slice(0, -1).join("/");
  return parent || "Server-Ordner";
}

function iconForInput(input: CreateLocalServerInput) {
  if (input.iconPath === "preset:plugins") return "solar:widget-bold";
  if (input.iconPath === "preset:mods") return "solar:box-bold";
  if (input.iconPath === "preset:codex") return "solar:code-bold";
  return "solar:server-square-bold";
}

function iconForServer(server: LocalServer) {
  if (server.iconPath === "preset:plugins") return "solar:widget-bold";
  if (server.iconPath === "preset:mods") return "solar:box-bold";
  if (server.iconPath === "preset:codex") return "solar:code-bold";
  if (server.serverType === "fabric") return "solar:box-bold";
  if (server.serverType === "forge") return "solar:hammer-bold";
  if (server.serverType === "neoforge") return "solar:stars-bold";
  if (server.serverType === "bedrock") return "solar:box-bold";
  if (server.serverType === "vanilla") return "solar:gamepad-bold";
  if (server.serverType === "spigot" || server.serverType === "bukkit") return "solar:plug-circle-bold";
  return "solar:server-square-bold";
}

function statusLabel(status: LocalServer["status"]) {
  return status === "running" ? "Läuft" : "Gestoppt";
}

function loaderLabel(serverType: LocalServer["serverType"]) {
  switch (serverType) {
    case "fabric":
      return "Fabric";
    case "forge":
      return "Forge";
    case "neoforge":
      return "NeoForge";
    case "vanilla":
      return "Vanilla";
    case "bedrock":
      return "Bedrock";
    case "spigot":
      return "Spigot";
    case "bukkit":
      return "Bukkit";
    default:
      return "Paper";
  }
}

function kindForServerType(serverType: CreateLocalServerInput["serverType"]): LocalServerKind {
  if (serverType === "fabric" || serverType === "forge" || serverType === "neoforge") return "modpack";
  if (serverType === "vanilla") return "vanilla";
  if (serverType === "bedrock") return "bedrock";
  return "plugins";
}

function isPluginServerType(serverType: LocalServer["serverType"]) {
  return serverType === "paper" || serverType === "spigot" || serverType === "bukkit";
}

function isModServerType(serverType: LocalServer["serverType"]) {
  return serverType === "fabric" || serverType === "forge" || serverType === "neoforge";
}

function loaderVersionServerType(serverType: LocalServer["serverType"]) {
  return isModServerType(serverType);
}

function nextAvailablePort(servers: LocalServer[], basePort: number) {
  const usedPorts = new Set(servers.map((server) => server.port));
  let port = basePort;
  while (usedPorts.has(port) && port < 65535) {
    port += 1;
  }
  return port;
}

function isPluginServer(server: LocalServer) {
  return (server.serverKind ?? kindForServerType(server.serverType)) === "plugins";
}

function isModpackServer(server: LocalServer) {
  return (server.serverKind ?? kindForServerType(server.serverType)) === "modpack";
}
