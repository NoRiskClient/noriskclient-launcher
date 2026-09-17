import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/buttons/Button';
import { Icon } from '@iconify/react';
import { BannerCard } from '../ui/BannerCard';
import { openExternalUrl } from '../../services/tauri-service';
import { LEGAL_DOCUMENT_URLS, legalLocale } from '../../config/legal';

interface AnalyticsConsentBannerProps {
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}

export function AnalyticsConsentBanner({ onAccept, onDecline, onDismiss }: AnalyticsConsentBannerProps) {
  const { t, i18n } = useTranslation();
  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)]">
      <BannerCard onDismiss={onDismiss} dismissTitle={t('analytics.banner.dismiss')}>
        <div className="flex items-start gap-3 pr-8">
          <Icon icon="solar:chart-square-bold" className="w-6 h-6 text-accent flex-shrink-0 mt-1" />

          <div className="flex-1 min-w-0">
            <h3 className="text-base font-smallcaps text-white mb-2">
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

            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={onDecline}
                variant="ghost"
                size="sm"
                className="px-3 py-1.5 text-gray-300 hover:text-white hover:bg-white/10 font-smallcaps text-xs"
              >
                {t('analytics.banner.decline')}
              </Button>
              <Button
                onClick={onAccept}
                variant="default"
                size="sm"
                className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-black font-smallcaps text-xs"
              >
                {t('analytics.banner.accept')}
              </Button>
            </div>
          </div>
        </div>
      </BannerCard>
    </div>
  );
}
