import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { ProfileSummary } from "./profile-summary";

export function ProfileSection({ profile }: { profile: ProfileSummary }) {
  const { t } = useTranslation();
  const { streak, rows } = profile;

  return (
    <section>
      <p className="fw-label mb-2">{t("friends.profile_title")}</p>
      <div className="fw-card">
        {streak && (
          <div className="fw-stats">
            <StreakStat
              icon="solar:fire-bold"
              days={streak.running}
              label={t("friends.profile_streak")}
              dim={streak.running === 0}
            />
            <StreakStat icon="solar:cup-star-bold" days={streak.best} label={t("friends.profile_best_streak")} />
          </div>
        )}
        {rows.length > 0 && (
          <div className={streak ? "fw-card-rows fw-card-rows-split" : "fw-card-rows"}>
            {rows.map((row) => (
              <div key={row.label} className="fw-card-row">
                <Icon icon={row.icon} className={row.accent ? "fw-card-row-icon fw-accent" : "fw-card-row-icon"} />
                <span className="fw-name fw-muted min-w-0 flex-1 truncate">{row.label}</span>
                <span className={row.accent ? "fw-name fw-accent shrink-0" : "fw-name fw-ink shrink-0"}>{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function StreakStat({ icon, days, label, dim = false }: { icon: string; days: number; label: string; dim?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="fw-stat" data-dim={dim}>
      <Icon icon={icon} className="fw-stat-icon h-[18px] w-[18px]" />
      <p className="mt-2.5 flex items-baseline gap-1.5">
        <span className="fw-stat-value fw-num">{days}</span>
        <span className="fw-meta fw-muted">{t("friends.profile_days_unit", { count: days })}</span>
      </p>
      <p className="fw-meta fw-faint mt-0.5 truncate">{label}</p>
    </div>
  );
}
