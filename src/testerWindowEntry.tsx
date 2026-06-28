import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TesterWindow } from "./components/tester/TesterWindow";
import { GlobalToaster } from "./components/ui/GlobalToaster";
import { ScrollbarProvider } from "./components/ui/ScrollbarProvider";
import i18n from "./i18n/i18n";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <ScrollbarProvider />
      <TesterWindow />
      <GlobalToaster />
    </I18nextProvider>
  </React.StrictMode>,
);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    getCurrentWindow().show().catch(() => {});
  });
});
