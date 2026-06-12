"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { useNavigate, useParams } from "react-router-dom";
import { EditionSwitch } from "../edition/EditionSwitch";
import { LocalServerService } from "../../services/local-server-service";
import type { BedrockContentKind, BedrockProfile } from "../../types/localServer";
import { getErrorMessage } from "../../utils/error-utils";

const contentTabs: Array<{ id: BedrockContentKind; label: string; icon: string }> = [
  { id: "addon", label: "Add-ons", icon: "solar:box-minimalistic-bold" },
  { id: "resourcepack", label: "Resourcepacks", icon: "solar:gallery-bold" },
  { id: "world", label: "Welten", icon: "solar:planet-bold" },
  { id: "skinpack", label: "Skinpacks", icon: "solar:user-id-bold" },
];

function imageSource(path?: string | null) {
  if (!path) return null;
  return /^(https?:|data:|asset:)/i.test(path) || path.startsWith("/") ? path : convertFileSrc(path);
}

export function BedrockProfileDetailView() {
  const { profileId = "" } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<BedrockProfile | null>(null);
  const [activeTab, setActiveTab] = useState<BedrockContentKind | "settings">("addon");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");

  const loadProfile = useCallback(async () => {
    try {
      const profiles = await LocalServerService.listBedrockProfiles();
      const found = profiles.find((item) => item.id === profileId) ?? null;
      setProfile(found);
      setName(found?.name ?? "");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }, [profileId]);

  useEffect(() => void loadProfile(), [loadProfile]);

  const visibleContent = useMemo(
    () => profile?.installedContent.filter((item) => item.kind === activeTab) ?? [],
    [activeTab, profile],
  );

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const launch = () => run(async () => {
    const updated = await LocalServerService.launchBedrockProfile(profileId);
    setProfile(updated);
    window.dispatchEvent(new CustomEvent("nrc-bedrock-instance-changed"));
  });

  const importContent = (kind: BedrockContentKind) => run(async () => {
    const selected = await LocalServerService.pickBedrockContentFile(kind);
    if (!selected) return;
    const updated = await LocalServerService.importBedrockProfileContent(profileId, selected, kind);
    setProfile(updated);
    toast.success("Inhalt wurde importiert");
  });

  const saveSettings = () => run(async () => {
    if (!profile) return;
    const updated = await LocalServerService.updateBedrockProfile(profileId, {
      name: name.trim() || profile.name,
      target: profile.target,
    });
    setProfile(updated);
    toast.success("Profil gespeichert");
  });

  const createServer = () => run(async () => {
    if (!profile) return;
    const servers = await LocalServerService.listServers();
    const usedPorts = new Set(servers.map((server) => server.port));
    let port = 19132;
    while (usedPorts.has(port)) port += 1;
    const server = await LocalServerService.createServer({
      name: `${profile.name} Server`,
      serverType: "bedrock",
      serverKind: "bedrock",
      minecraftVersion: "latest",
      port,
      ramMb: 2048,
      description: `Aus Bedrock-Profil ${profile.name} erstellt`,
      iconPath: profile.iconPath,
      codexEnabled: false,
    });
    localStorage.setItem("nrc-open-server-id", server.id);
    navigate("/servers");
  });

  if (!profile) {
    return <div className="h-full grid place-items-center text-white/45 font-minecraft-ten">Bedrock-Profil wird geladen...</div>;
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden bg-[#080a0d]">
      <header className="shrink-0 border-b border-white/10 px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button type="button" onClick={() => navigate("/profiles")} className="w-10 h-10 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 grid place-items-center text-white/70" title="Zurück">
              <Icon icon="solar:arrow-left-bold" className="w-5 h-5" />
            </button>
            <div className="w-16 h-16 rounded-lg border border-white/15 bg-white/5 overflow-hidden grid place-items-center shrink-0">
              {imageSource(profile.iconPath) ? <img src={imageSource(profile.iconPath)!} alt="" className="w-full h-full object-cover" /> : <Icon icon="solar:box-bold" className="w-8 h-8 text-white/55" />}
            </div>
            <div className="min-w-0">
              <h1 className="font-minecraft-ten text-3xl text-white truncate">{profile.name}</h1>
              <div className="mt-2 flex items-center gap-2 font-minecraft-ten text-xs text-white/45">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Bedrock {profile.target === "preview" ? "Preview" : "Release"}</span>
                <span>{profile.installedContent.length} Inhalte</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <EditionSwitch />
            <button type="button" onClick={createServer} disabled={busy} className="h-11 px-4 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white font-minecraft-ten flex items-center gap-2 disabled:opacity-50"><Icon icon="solar:server-bold" />Server erstellen</button>
            <button type="button" onClick={launch} disabled={busy} className="h-11 px-6 rounded-lg border border-emerald-400/40 bg-emerald-500/20 hover:bg-emerald-500/30 text-white font-minecraft-ten flex items-center gap-2 disabled:opacity-50"><Icon icon={busy ? "solar:refresh-bold" : "solar:play-bold"} className={busy ? "animate-spin" : ""} />Spielen</button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-r border-white/10 p-3 space-y-1 overflow-y-auto">
          {contentTabs.map((tab) => (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`w-full h-11 rounded-lg px-3 flex items-center gap-3 font-minecraft-ten text-sm ${activeTab === tab.id ? "bg-white/12 text-white border border-white/15" : "text-white/55 hover:bg-white/5 hover:text-white"}`}>
              <Icon icon={tab.icon} className="w-5 h-5" /><span className="flex-1 text-left">{tab.label}</span><span className="text-white/35">{profile.installedContent.filter((item) => item.kind === tab.id).length}</span>
            </button>
          ))}
          <div className="my-3 border-t border-white/10" />
          <button type="button" onClick={() => setActiveTab("settings")} className={`w-full h-11 rounded-lg px-3 flex items-center gap-3 font-minecraft-ten text-sm ${activeTab === "settings" ? "bg-white/12 text-white border border-white/15" : "text-white/55 hover:bg-white/5 hover:text-white"}`}><Icon icon="solar:settings-bold" className="w-5 h-5" />Einstellungen</button>
          <button type="button" onClick={() => run(() => LocalServerService.openBedrockProfileFolder(profileId))} className="w-full h-11 rounded-lg px-3 flex items-center gap-3 font-minecraft-ten text-sm text-white/55 hover:bg-white/5 hover:text-white"><Icon icon="solar:folder-open-bold" className="w-5 h-5" />Ordner öffnen</button>
        </aside>

        <main className="min-w-0 overflow-y-auto p-5">
          {activeTab === "settings" ? (
            <section className="max-w-2xl">
              <h2 className="font-minecraft-ten text-2xl text-white">Einstellungen</h2>
              <div className="mt-5 space-y-4 rounded-lg border border-white/10 bg-black/25 p-5">
                <label className="block font-minecraft-ten text-sm text-white/55">Profilname<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full h-11 rounded-lg border border-white/10 bg-black/40 px-3 text-white outline-none focus:border-white/30" /></label>
                <div>
                  <p className="font-minecraft-ten text-sm text-white/55 mb-2">Version</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(["release", "preview"] as const).map((target) => <button key={target} type="button" onClick={() => setProfile({ ...profile, target })} className={`h-11 rounded-lg border font-minecraft-ten ${profile.target === target ? "border-white/30 bg-white/15 text-white" : "border-white/10 bg-white/5 text-white/50"}`}>{target === "release" ? "Release" : "Preview"}</button>)}
                  </div>
                </div>
                <button type="button" onClick={saveSettings} disabled={busy} className="h-11 px-5 rounded-lg bg-white/15 hover:bg-white/20 border border-white/20 text-white font-minecraft-ten disabled:opacity-50">Speichern</button>
              </div>
            </section>
          ) : (
            <section>
              <div className="flex items-center justify-between gap-4 mb-5">
                <div><h2 className="font-minecraft-ten text-2xl text-white">{contentTabs.find((tab) => tab.id === activeTab)?.label}</h2><p className="font-minecraft-ten text-xs text-white/40 mt-1">Lokale Bedrock-Inhalte dieses Profils</p></div>
                <button type="button" onClick={() => importContent(activeTab)} disabled={busy} className="h-10 px-4 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white font-minecraft-ten flex items-center gap-2 disabled:opacity-50"><Icon icon="solar:upload-bold" />Importieren</button>
              </div>
              {visibleContent.length === 0 ? (
                <div className="min-h-56 rounded-lg border border-dashed border-white/10 grid place-items-center text-center"><div><Icon icon="solar:inbox-bold" className="w-10 h-10 text-white/25 mx-auto" /><p className="mt-3 font-minecraft-ten text-white/45">Noch keine Inhalte installiert</p></div></div>
              ) : (
                <div className="space-y-2">{visibleContent.map((item) => <div key={`${item.kind}-${item.fileName}`} className="h-16 rounded-lg border border-white/10 bg-black/25 px-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-white/5 grid place-items-center text-white/55"><Icon icon="solar:file-bold" className="w-5 h-5" /></div><div className="min-w-0 flex-1"><p className="font-minecraft-ten text-white truncate">{item.name}</p><p className="font-minecraft-ten text-[10px] text-white/35 truncate">{item.fileName}</p></div><button type="button" onClick={() => run(() => LocalServerService.openBedrockProfileContent(profileId, item.fileName, item.kind))} className="w-9 h-9 rounded-full hover:bg-white/10 grid place-items-center text-white/55" title="In Bedrock öffnen"><Icon icon="solar:play-bold" /></button><button type="button" onClick={() => run(async () => setProfile(await LocalServerService.deleteBedrockProfileContent(profileId, item.fileName, item.kind)))} className="w-9 h-9 rounded-full hover:bg-red-500/15 grid place-items-center text-white/45 hover:text-red-300" title="Löschen"><Icon icon="solar:trash-bin-trash-bold" /></button></div>)}</div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
