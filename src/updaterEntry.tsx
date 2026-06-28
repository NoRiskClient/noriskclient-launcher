import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import Updater from "./components/updater/Updater";
import i18n from "./i18n/i18n";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <Updater />
    </I18nextProvider>
  </React.StrictMode>,
);
