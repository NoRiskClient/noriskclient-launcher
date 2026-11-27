import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFriendsStore, type FriendsUser } from "../../../store/friends-store";
import { toast } from "../../ui/GlobalToaster";
import { translateApiError } from "../../../utils/nrc-error-translations";
import { PlayerAvatar } from "./PlayerAvatar";
import { StatusOptions } from "./SelfBar";
import { statusMeta } from "./status";
import { ViewHeader } from "./ViewHeader";

type PrivacyKey = keyof FriendsUser["privacy"];

const PRIVACY: { key: PrivacyKey; labelKey: string; descKey: string }[] = [
  { key: "showServer", labelKey: "friends.settings.show_server", descKey: "friends.settings.show_server_long" },
  { key: "allowRequests", labelKey: "friends.settings.allow_requests", descKey: "friends.settings.allow_requests_long" },
  { key: "allowServerInvites", labelKey: "friends.settings.server_invites", descKey: "friends.settings.server_invites_long" },
];

export function SettingsView() {
  const { t } = useTranslation();
  const currentUser = useFriendsStore((s) => s.currentUser);
  const updatePrivacySetting = useFriendsStore((s) => s.updatePrivacySetting);
  const [saving, setSaving] = useState<PrivacyKey | null>(null);

  const toggle = async (key: PrivacyKey) => {
    if (!currentUser || saving) return;
    setSaving(key);
    try {
      await updatePrivacySetting(key, !currentUser.privacy[key]);
    } catch (e) {
      toast.error(translateApiError(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <ViewHeader icon="solar:settings-bold" title={t("common.settings")} />
      <div className="fw-scroll min-h-0 flex-1">
        {currentUser && (
          <div className="mx-auto max-w-[620px] px-6 py-6">
            <div className="flex items-center gap-4">
              <PlayerAvatar
                uuid={currentUser.uuid}
                name={currentUser.username}
                size={48}
                status={currentUser.state}
                ringColor="var(--fw-bg)"
                self
              />
              <div className="min-w-0">
                <p className="fw-title fw-ink truncate">{currentUser.username}</p>
                <p className="fw-meta fw-faint">{t(statusMeta(currentUser.state, true).labelKey)}</p>
              </div>
            </div>

            <div className="mt-8">
              <div className="fw-line-b pb-2">
                <span className="fw-label">{t("friends.settings.status")}</span>
              </div>
              <div className="pt-2">
                <StatusOptions current={currentUser.state} />
              </div>
              <p className="fw-meta fw-faint mt-2 px-2.5">{t("friends.settings.status_hint")}</p>
            </div>

            <div className="mt-8">
              <div className="fw-line-b pb-2">
                <span className="fw-label">{t("friends.settings.privacy")}</span>
              </div>
              <ul>
                {PRIVACY.map((item) => {
                  const on = currentUser.privacy[item.key];
                  return (
                    <li key={item.key} className="fw-sep flex items-center gap-4 py-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="fw-name fw-ink">{t(item.labelKey)}</p>
                        <p className="fw-meta fw-faint mt-0.5">{t(item.descKey)}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        className="fw-switch"
                        aria-checked={on}
                        aria-label={t(item.labelKey)}
                        disabled={saving === item.key}
                        onClick={() => toggle(item.key)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
