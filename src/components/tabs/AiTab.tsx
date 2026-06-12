"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useProfileStore } from "../../store/profile-store";
import { LocalServerService } from "../../services/local-server-service";
import type { LocalServer } from "../../types/localServer";

const AI_ICON_SRC = "/NRclientaisymbol-v2.png";
const CHAT_STORAGE_KEY = "nrc-ai-preview-chats";

type AttachmentType = "profile" | "server" | "image";

interface AiAttachment {
  id: string;
  type: AttachmentType;
  label: string;
  subtitle?: string;
}

interface AiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: AiAttachment[];
}

interface AiChat {
  id: string;
  title: string;
  messages: AiMessage[];
}

function createChat(title: string, welcome: string, hint: string): AiChat {
  return {
    id: crypto.randomUUID(),
    title,
    messages: [
      { id: crypto.randomUUID(), role: "assistant", text: welcome },
      { id: crypto.randomUUID(), role: "assistant", text: hint },
    ],
  };
}

function AiLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dimensions = size === "lg" ? "w-16 h-16" : size === "sm" ? "w-9 h-9" : "w-10 h-10";
  return (
    <div className={`${dimensions} rounded-xl border border-white/15 bg-white/10 overflow-hidden flex items-center justify-center shrink-0`}>
      <img src={AI_ICON_SRC} alt="" className="w-[72%] h-[72%] object-contain" draggable={false} />
    </div>
  );
}

export function AiTab() {
  const { t } = useTranslation();
  const { profiles, fetchProfiles } = useProfileStore();
  const [servers, setServers] = useState<LocalServer[]>([]);
  const [chats, setChats] = useState<AiChat[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) return JSON.parse(saved) as AiChat[];
    } catch {
      // A broken preview history should never block the launcher.
    }
    return [createChat(t("ai.defaultChat"), t("ai.messageWelcome"), t("ai.messageHint"))];
  });
  const [activeChatId, setActiveChatId] = useState(chats[0]?.id || "");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [picker, setPicker] = useState<AttachmentType | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enterToSend, setEnterToSend] = useState(true);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) || chats[0],
    [activeChatId, chats],
  );

  useEffect(() => {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    void fetchProfiles();
    LocalServerService.listServers().then(setServers).catch(() => setServers([]));
  }, [fetchProfiles]);

  const addChat = () => {
    const chat = createChat(t("ai.newChat"), t("ai.messageWelcome"), t("ai.messageHint"));
    setChats((current) => [chat, ...current]);
    setActiveChatId(chat.id);
    setInput("");
    setAttachments([]);
  };

  const addAttachment = (attachment: AiAttachment) => {
    setAttachments((current) => current.some((item) => item.id === attachment.id) ? current : [...current, attachment]);
    setPicker(null);
    setPlusMenuOpen(false);
  };

  const pickImage = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Bilder", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof selected !== "string") return;
    const label = selected.split(/[\\/]/).pop() || selected;
    addAttachment({ id: `image:${selected}`, type: "image", label, subtitle: selected });
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text || !activeChat) return;
    const userMessage: AiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      attachments: attachments.length ? attachments : undefined,
    };
    const previewReply: AiMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: t("ai.previewReply", { defaultValue: "Diese AI ist bald verfügbar. Deine Nachricht und Anhänge wurden für diesen Vorschau-Chat gespeichert." }),
    };
    setChats((current) => current.map((chat) => chat.id === activeChat.id
      ? { ...chat, title: chat.messages.length <= 2 ? text.slice(0, 32) : chat.title, messages: [...chat.messages, userMessage, previewReply] }
      : chat));
    setInput("");
    setAttachments([]);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <AiLogo size="lg" />
          <div>
            <h1 className="font-minecraft text-white text-5xl normal-case">{t("ai.title")}</h1>
            <p className="font-minecraft-ten text-white/45 text-base">{t("ai.comingSoon")}</p>
          </div>
        </div>
        <div className="relative">
          <button type="button" onClick={() => setSettingsOpen((openState) => !openState)} className="w-11 h-11 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-white/70 flex items-center justify-center">
            <Icon icon="solar:settings-bold" className="w-5 h-5" />
          </button>
          {settingsOpen && (
            <div className="absolute right-0 top-14 z-30 w-72 rounded-xl border border-white/15 bg-[#15181f] p-3 shadow-2xl">
              <p className="font-minecraft-ten text-white mb-3">{t("common.settings")}</p>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-3 font-minecraft-ten text-sm text-white/70">
                <span>{t("ai.enterToSend", { defaultValue: "Enter zum Senden" })}</span>
                <input type="checkbox" checked={enterToSend} onChange={(event) => setEnterToSend(event.target.checked)} />
              </label>
              <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3 font-minecraft-ten text-sm text-white/45">
                {t("ai.historyLocal", { defaultValue: "Chats werden nur lokal auf diesem PC gespeichert." })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[300px_1fr] gap-5 min-h-0 flex-1">
        <aside className="border border-white/10 bg-black/35 rounded-xl p-4 min-h-0 flex flex-col">
          <button type="button" onClick={addChat} className="w-full rounded-full border border-white/20 bg-white/10 hover:bg-white/15 px-4 py-3 font-minecraft-ten text-white text-sm flex items-center justify-center gap-2">
            <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
            {t("ai.newChat")}
          </button>
          <h2 className="mt-5 mb-2 font-minecraft-ten text-white/65 text-sm uppercase">{t("ai.chatList")}</h2>
          <div className="space-y-2 overflow-y-auto custom-scrollbar pr-1">
            {chats.map((chat) => (
              <button key={chat.id} type="button" onClick={() => setActiveChatId(chat.id)} className={`w-full rounded-xl border p-3 text-left transition-colors ${activeChatId === chat.id ? "border-white/25 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                <span className="block font-minecraft-ten text-white text-base truncate">{chat.title}</span>
                <span className="block font-minecraft-ten text-white/40 text-xs truncate">{chat.messages.at(-1)?.text}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 border border-white/10 bg-black/25 rounded-xl flex flex-col overflow-hidden">
          <div className="border-b border-white/10 px-5 py-4 flex items-center gap-3">
            <AiLogo />
            <div className="min-w-0 flex-1">
              <h2 className="font-minecraft-ten text-white text-lg truncate">{activeChat?.title}</h2>
              <p className="font-minecraft-ten text-white/35 text-xs">{t("ai.comingSoon")}</p>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 space-y-4">
            {activeChat?.messages.map((message) => (
              <div key={message.id} className={`flex items-start gap-3 ${message.role === "user" ? "justify-end" : ""}`}>
                {message.role === "assistant" && <AiLogo size="sm" />}
                <div className={`max-w-[760px] rounded-2xl border px-4 py-3 ${message.role === "user" ? "rounded-tr-md border-white/20 bg-white/10" : "rounded-tl-md border-white/10 bg-white/5"}`}>
                  {!!message.attachments?.length && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {message.attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} />)}
                    </div>
                  )}
                  <p className="font-minecraft-ten text-white/80 text-base leading-relaxed whitespace-pre-wrap">{message.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-white/10 p-4">
            {!!attachments.length && (
              <div className="flex flex-wrap gap-2 mb-3">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex items-center gap-1">
                    <AttachmentChip attachment={attachment} />
                    <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} className="w-7 h-7 rounded-full text-white/45 hover:text-white hover:bg-white/10 flex items-center justify-center">
                      <Icon icon="solar:close-circle-bold" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative flex items-end gap-3 rounded-2xl border border-white/15 bg-black/35 px-3 py-3">
              <button type="button" onClick={() => setPlusMenuOpen((openState) => !openState)} className="w-10 h-10 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/70">
                <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
              </button>
              {plusMenuOpen && (
                <div className="absolute left-3 bottom-16 z-40 w-64 rounded-xl border border-white/15 bg-[#15181f] p-2 shadow-2xl">
                  <AttachMenuButton icon="solar:user-id-bold" label={t("ai.attachProfile")} onClick={() => setPicker("profile")} />
                  <AttachMenuButton icon="solar:server-square-bold" label={t("ai.attachServer", { defaultValue: "Server anhängen" })} onClick={() => setPicker("server")} />
                  <AttachMenuButton icon="solar:gallery-add-bold" label={t("ai.attachImage", { defaultValue: "Bild anhängen" })} onClick={() => void pickImage()} />
                </div>
              )}
              <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (enterToSend && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder={t("ai.inputPlaceholder", { defaultValue: "Schreibe eine Nachricht..." })} rows={1} className="min-h-10 max-h-32 flex-1 resize-none bg-transparent outline-none font-minecraft-ten text-white placeholder:text-white/30 text-base py-2" />
              <button type="button" onClick={sendMessage} disabled={!input.trim()} className="w-10 h-10 rounded-full border border-white/15 bg-white/10 hover:bg-white/20 disabled:opacity-35 flex items-center justify-center text-white">
                <Icon icon="solar:plain-bold" className="w-5 h-5" />
              </button>
            </div>
          </div>
        </main>
      </div>

      {picker && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-8" onClick={() => setPicker(null)}>
          <div className="w-full max-w-xl max-h-[70vh] rounded-xl border border-white/15 bg-[#101218] p-4 shadow-2xl flex flex-col" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-minecraft text-3xl text-white normal-case">{picker === "profile" ? t("ai.attachProfile") : t("ai.attachServer", { defaultValue: "Server anhängen" })}</h3>
              <button type="button" onClick={() => setPicker(null)} className="w-9 h-9 rounded-full hover:bg-white/10 text-white/60 flex items-center justify-center"><Icon icon="solar:close-circle-bold" /></button>
            </div>
            <div className="space-y-2 overflow-y-auto custom-scrollbar">
              {picker === "profile" ? profiles.map((profile) => (
                <PickerRow key={profile.id} icon="solar:gamepad-bold" title={profile.name} subtitle={`${profile.game_version || "Minecraft"} / ${profile.loader || "Vanilla"}`} onClick={() => addAttachment({ id: `profile:${profile.id}`, type: "profile", label: profile.name, subtitle: profile.game_version })} />
              )) : servers.map((server) => (
                <PickerRow key={server.id} icon="solar:server-square-bold" title={server.name} subtitle={`${server.status === "running" ? "Online" : "Offline"} / ${server.serverIp || `localhost:${server.port}`}`} onClick={() => addAttachment({ id: `server:${server.id}`, type: "server", label: server.name, subtitle: server.status })} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AttachMenuButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="w-full rounded-lg px-3 py-2.5 text-left font-minecraft-ten text-white/75 hover:text-white hover:bg-white/10 text-sm flex items-center gap-2"><Icon icon={icon} className="w-4 h-4" />{label}</button>;
}

function AttachmentChip({ attachment }: { attachment: AiAttachment }) {
  const icon = attachment.type === "profile" ? "solar:user-id-bold" : attachment.type === "server" ? "solar:server-square-bold" : "solar:gallery-bold";
  return <span className="max-w-60 rounded-full border border-white/15 bg-black/30 px-3 py-1.5 font-minecraft-ten text-xs text-white/70 flex items-center gap-2"><Icon icon={icon} className="shrink-0" /><span className="truncate">{attachment.label}</span></span>;
}

function PickerRow({ icon, title, subtitle, onClick }: { icon: string; title: string; subtitle: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-left flex items-center gap-3"><span className="w-11 h-11 rounded-lg border border-white/10 bg-black/30 flex items-center justify-center text-white/60"><Icon icon={icon} className="w-5 h-5" /></span><span className="min-w-0"><span className="block font-minecraft-ten text-white truncate">{title}</span><span className="block font-minecraft-ten text-white/40 text-xs truncate">{subtitle}</span></span></button>;
}
