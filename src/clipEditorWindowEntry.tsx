import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { ClipEditorWindow } from "./components/clips/ClipEditorWindow";
import { GlobalToaster } from "./components/ui/GlobalToaster";
import { GlobalModalPortal } from "./components/ui/GlobalModalPortal";
import i18n from "./i18n/i18n";
import { revealAfterFirstPaint } from "./utils/reveal-window";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <ClipEditorWindow />
      <GlobalToaster />
      <GlobalModalPortal />
    </I18nextProvider>
  </React.StrictMode>,
);

revealAfterFirstPaint();
