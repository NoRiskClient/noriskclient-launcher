import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MinecraftLogWindow } from "./components/log/MinecraftLogWindow";
import { GlobalToaster } from "./components/ui/GlobalToaster";
import i18n from "./i18n/i18n";
import "./styles/globals.css";
import type { ProcessMetadata } from "./types/processState";

// Parse URL params for crashed process info
const urlParams = new URLSearchParams(window.location.search);
const crashedProcessParam = urlParams.get("crashedProcess");
let crashedProcess: ProcessMetadata | undefined;

if (crashedProcessParam) {
  try {
    crashedProcess = JSON.parse(crashedProcessParam) as ProcessMetadata;
    console.log("[MinecraftLogWindowEntry] Parsed crashed process:", crashedProcess);
  } catch (e) {
    console.error("[MinecraftLogWindowEntry] Failed to parse crashed process:", e);
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <MinecraftLogWindow crashedProcess={crashedProcess} />
      <GlobalToaster />
    </I18nextProvider>
  </React.StrictMode>,
);

// Reveal the window only after the first paint to avoid the white flash.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    getCurrentWindow().show().catch(() => {});
  });
});
