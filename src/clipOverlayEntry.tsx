import "./polyfills";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { ClipOverlay } from "./components/overlay/ClipOverlay";
import i18n, { i18nReady } from "./i18n/i18n";
import "./styles/globals.css";
import { disableBackdropBlurOnLinux } from "./utils/platform";

disableBackdropBlurOnLinux();

void i18nReady.then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <I18nextProvider i18n={i18n}>
      <ClipOverlay />
    </I18nextProvider>,
  );
});
