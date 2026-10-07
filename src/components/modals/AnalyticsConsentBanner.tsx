import React, { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/buttons/Button';
import { Icon } from '@iconify/react';
import { BannerCard } from '../ui/BannerCard';
import { openExternalUrl } from '../../services/tauri-service';
import { LEGAL_DOCUMENT_URLS, legalLocale } from '../../config/legal';

interface AnalyticsConsentBannerProps {
  onAccept: () => void | Promise<boolean>;
  onDecline: () => void | Promise<boolean>;
  onDismiss: () => void;
  pending?: boolean;
  error?: string | null;
  draft?: "accepted" | "declined" | null;
}

export function AnalyticsConsentBanner({ onAccept, onDecline, onDismiss, pending = false, error = null, draft = null }: AnalyticsConsentBannerProps) {
  const { t, i18n } = useTranslation();
  const errorId = useId();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  const focusOwnPanel = (action: HTMLButtonElement | null) => {
    if (action && document.activeElement === action) panelRef.current?.focus({ preventScroll: true });
  };
  const accept = () => { focusOwnPanel(acceptRef.current); return onAccept(); };
  const decline = () => { focusOwnPanel(declineRef.current); return onDecline(); };
  return (
    <div ref={panelRef} role="group" aria-labelledby={titleId} tabIndex={-1}
      className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80">
      <BannerCard onDismiss={pending ? undefined : onDismiss} dismissTitle={t('analytics.banner.dismiss')}>
        <div className="flex items-start gap-3 pr-8">
          <Icon icon="solar:chart-square-bold" className="w-6 h-6 text-accent flex-shrink-0 mt-1" />

          <div className="flex-1 min-w-0">
            <h3 id={titleId} className="text-base font-smallcaps text-white mb-2">
              {t('analytics.banner.title')}
            </h3>

            <p className="text-sm text-gray-300 font-minecraft leading-relaxed mb-4">
              {t('analytics.banner.description')}{' '}
              <button
                onClick={() => openExternalUrl(LEGAL_DOCUMENT_URLS.privacy[legalLocale(i18n.language)])}
                className="text-accent hover:text-accent-hover underline underline-offset-2 transition-colors text-sm"
              >
                {t('analytics.banner.learn_more')}
              </button>
            </p>

            <div className="grid min-h-8 mb-3 text-sm font-minecraft break-words">
              {/* Reserve the actual localized failure copy, including font-dependent wrapping. */}
              <p aria-hidden="true" className="invisible pointer-events-none col-start-1 row-start-1">{t('analytics.toast.enable_failed')}</p>
              <p aria-hidden="true" className="invisible pointer-events-none col-start-1 row-start-1">{t('analytics.toast.disable_failed')}</p>
              <p id={errorId} role={error ? "alert" : undefined} className="col-start-1 row-start-1 text-red-300">{error}</p>
            </div>
            <div className="flex items-center justify-end gap-2" aria-busy={pending || undefined}>
              <Button
                ref={declineRef}
                onClick={decline}
                disabled={pending}
                aria-describedby={error ? errorId : undefined}
                aria-busy={pending && draft === "declined" || undefined}
                aria-label={error && draft === "declined" ? `${t('common.try_again')}: ${t('analytics.banner.decline')}` : undefined}
                variant="ghost"
                size="sm"
                className="px-3 py-1.5 text-gray-300 hover:text-white hover:bg-white/10 font-smallcaps text-xs"
              >
                {pending && draft === "declined" ? t('common.saving') : error && draft === "declined" ? t('common.try_again') : t('analytics.banner.decline')}
              </Button>
              <Button
                ref={acceptRef}
                onClick={accept}
                disabled={pending}
                aria-describedby={error ? errorId : undefined}
                aria-busy={pending && draft === "accepted" || undefined}
                aria-label={error && draft === "accepted" ? `${t('common.try_again')}: ${t('analytics.banner.accept')}` : undefined}
                variant="default"
                size="sm"
                className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-black font-smallcaps text-xs"
              >
                {pending && draft === "accepted" ? t('common.saving') : error && draft === "accepted" ? t('common.try_again') : t('analytics.banner.accept')}
              </Button>
            </div>
          </div>
        </div>
      </BannerCard>
    </div>
  );
}
