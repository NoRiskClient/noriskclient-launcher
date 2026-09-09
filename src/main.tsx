import "./polyfills";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { router } from "./lib/router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ClipOverlay } from "./components/overlay/ClipOverlay";
import i18n from "./i18n/i18n";
import "./styles/globals.css";

const isOverlay = (() => {
  try {
    return getCurrentWindow().label === "clip-overlay";
  } catch {
    return false;
  }
})();

if (isOverlay) {
  document.documentElement.classList.add("overlay-window");
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <I18nextProvider i18n={i18n}>
    {isOverlay ? <ClipOverlay /> : <RouterProvider router={router} />}
  </I18nextProvider>,
);
