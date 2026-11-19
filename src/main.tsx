import "./polyfills";
import { disableBackdropBlurOnLinux, initializeClipSupport } from "./utils/platform";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { router } from "./lib/router";
import i18n, { i18nReady } from "./i18n/i18n";
import "./styles/globals.css";

disableBackdropBlurOnLinux();

const render = () => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <I18nextProvider i18n={i18n}>
    <RouterProvider router={router} />
  </I18nextProvider>,
);

Promise.all([
  i18nReady,
  initializeClipSupport().catch((error) => console.error("Could not check clip support", error)),
]).finally(render);
