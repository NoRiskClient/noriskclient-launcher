import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { LogWindow } from "./components/log/LogWindow";
import { GlobalToaster } from "./components/ui/GlobalToaster";
import i18n from "./i18n/i18n";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <LogWindow />
      <GlobalToaster />
    </I18nextProvider>
  </React.StrictMode>,
);
