import { useTranslation } from "react-i18next";
import { useBlurSettingsStore } from "../../store/blur-settings-store";
import { Toggle } from "../ui/Toggle";

export function BlurSettings() {
  const { t } = useTranslation();
  const { disableBlurInGame, setDisableBlurInGame } = useBlurSettingsStore();

  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-colors">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-white cursor-pointer">
          {t("settings.blur.title")}
        </label>
        <p className="text-xs text-white/60">
          {t("settings.blur.description")}
        </p>
      </div>
      <Toggle
        checked={disableBlurInGame}
        onCheckedChange={setDisableBlurInGame}
      />
    </div>
  );
}
