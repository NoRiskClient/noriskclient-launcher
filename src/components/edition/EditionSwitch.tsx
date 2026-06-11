"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";

export type LauncherEdition = "java" | "bedrock";

const EDITION_STORAGE_KEY = "nrc-launcher-edition";
export const MINECRAFT_BEDROCK_BUY_URL =
  "https://www.minecraft.net/de-de/store/minecraft-java-bedrock-edition-pc";

function readStoredEdition(): LauncherEdition {
  if (typeof window === "undefined") return "java";
  return localStorage.getItem(EDITION_STORAGE_KEY) === "bedrock" ? "bedrock" : "java";
}

export function useLauncherEdition() {
  const [edition, setEditionState] = useState<LauncherEdition>(readStoredEdition);

  useEffect(() => {
    const sync = () => setEditionState(readStoredEdition());
    window.addEventListener("storage", sync);
    window.addEventListener("nrc-edition-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("nrc-edition-change", sync);
    };
  }, []);

  const setEdition = (nextEdition: LauncherEdition) => {
    localStorage.setItem(EDITION_STORAGE_KEY, nextEdition);
    setEditionState(nextEdition);
    window.dispatchEvent(new CustomEvent("nrc-edition-change", { detail: nextEdition }));
  };

  return { edition, setEdition };
}

export function EditionSwitch({ className = "" }: { className?: string }) {
  const { edition, setEdition } = useLauncherEdition();

  return (
    <div className={`inline-flex items-center rounded-xl border border-white/15 bg-black/45 p-1 backdrop-blur-md ${className}`}>
      <button
        type="button"
        onClick={() => setEdition("java")}
        className={`h-10 px-4 rounded-lg flex items-center gap-2 font-minecraft-ten text-base transition-colors ${
          edition === "java" ? "bg-white/15 text-white" : "text-white/55 hover:text-white hover:bg-white/10"
        }`}
      >
        <Icon icon="solar:code-bold" className="w-4 h-4" />
        Java
      </button>
      <button
        type="button"
        onClick={() => setEdition("bedrock")}
        className={`h-10 px-4 rounded-lg flex items-center gap-2 font-minecraft-ten text-base transition-colors ${
          edition === "bedrock" ? "bg-white/15 text-white" : "text-white/55 hover:text-white hover:bg-white/10"
        }`}
      >
        <Icon icon="solar:box-bold" className="w-4 h-4" />
        Bedrock
      </button>
    </div>
  );
}
