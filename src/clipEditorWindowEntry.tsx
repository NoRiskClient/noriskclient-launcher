import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ClipEditorWindow } from "./components/clips/ClipEditorWindow";
import { GlobalToaster } from "./components/ui/GlobalToaster";
import { GlobalModalPortal } from "./components/ui/GlobalModalPortal";
import i18n from "./i18n/i18n";
import "./styles/globals.css";

const params = new URLSearchParams(window.location.search);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <ClipEditorWindow initial={{ path: params.get("path") ?? "", name: params.get("name") ?? "" }} />
      <GlobalToaster />
      <GlobalModalPortal />
    </I18nextProvider>
  </React.StrictMode>,
);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    getCurrentWindow().show().catch(() => {});
  });
});
