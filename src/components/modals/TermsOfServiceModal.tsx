import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/buttons/Button';
import { Icon } from '@iconify/react';
import { useThemeStore } from '../../store/useThemeStore';
import { BannerCard } from '../ui/BannerCard';
import { openExternalUrl } from '../../services/tauri-service';
import { toast } from 'react-hot-toast';

// Analytics Consent Banner Component
interface AnalyticsConsentBannerProps {
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}

export function AnalyticsConsentBanner({ onAccept, onDecline, onDismiss }: AnalyticsConsentBannerProps) {
  const { t } = useTranslation();
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
                onClick={() => openExternalUrl('https://blog.norisk.gg/en/privacy-policy/')}
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

interface TermsOfServiceModalProps {
  isOpen: boolean;
}

export function TermsOfServiceModal({ isOpen }: TermsOfServiceModalProps) {
  const { t } = useTranslation();
  const { acceptTermsOfService } = useThemeStore();

  const handleAccept = () => {
    acceptTermsOfService();
    toast.success(t('tos.toast.accepted'));
  };

  const handleOpenPrivacyPolicy = async () => {
    try {
      await openExternalUrl('https://norisk.gg/privacy');
      toast.success(t('tos.toast.privacy_opened'));
    } catch (error) {
      console.error("Failed to open Privacy Policy URL:", error);
      toast.error(t('tos.toast.privacy_failed'));
    }
  };

  const handleOpenTerms = async () => {
    try {
      await openExternalUrl('https://norisk.gg/tos');
      toast.success(t('tos.toast.terms_opened'));
    } catch (error) {
      console.error("Failed to open Terms URL:", error);
      toast.error(t('tos.toast.terms_failed'));
    }
  };

  if (!isOpen) {
    return null;
  }

  const modalFooter = (
    <div className="flex flex-wrap justify-end gap-3">
      <Button 
        onClick={handleAccept} 
        variant="default" 
        icon={<Icon icon="solar:check-circle-bold" className="w-5 h-5" />}
      >
        {t('tos.button.accept')}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t('tos.title')}
      titleIcon={<Icon icon="solar:document-bold" className="w-7 h-7 text-blue-400" />}
      onClose={() => {}} // Prevent closing without accepting
      width="lg"
      footer={modalFooter}
      closeOnClickOutside={false}
    >
      <div className="p-6 space-y-6 text-white" style={{paddingBottom: 0}}>
        <div className="text-center space-y-4">
          <h3 className="text-lg font-smallcaps text-blue-400">
            {t('tos.welcome')}
          </h3>
          <p className="text-lg font-minecraft text-gray-300">
            {t('tos.read_accept')}
          </p>
        </div>

        <div className="space-y-4 text-base font-minecraft text-gray-200 max-h-60 overflow-y-auto custom-scrollbar p-4 bg-black/30 rounded border border-gray-600">
          <div className="space-y-3">
            <h4 className="text-xs font-smallcaps text-white">{t('tos.key_points.title')}</h4>
            <ul className="space-y-2 list-disc list-inside text-sm">
              <li>{t('tos.key_points.legitimate_copy')}</li>
              <li>{t('tos.key_points.as_is')}</li>
              <li>{t('tos.key_points.minimal_data')}</li>
              <li>{t('tos.key_points.responsible_use')}</li>
              <li>{t('tos.key_points.update_terms')}</li>
              <li>{t('tos.key_points.minecraft_eula')}</li>
            </ul>
            
            <div className="pt-3 border-t border-gray-600">
              <p className="text-sm text-gray-400">
                {t('tos.full_terms_notice')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-4">
          <Button 
            onClick={handleOpenPrivacyPolicy} 
            variant="flat" 
            icon={<Icon icon="solar:document-text-linear" className="w-4 h-4" />}
            size="sm"
          >
            {t('tos.button.privacy_policy')}
          </Button>
          <Button 
            onClick={handleOpenTerms} 
            variant="flat" 
            icon={<Icon icon="solar:document-text-linear" className="w-4 h-4" />}
            size="sm"
          >
            {t('tos.button.view_full_terms')}
          </Button>
        </div>

        <div className="text-center text-base text-gray-400 flex justify-center">
          <p style={{lineHeight: 0.8, maxWidth: 600}}>
            {t('tos.withdraw_notice')}
          </p>
        </div>
      </div>
    </Modal>
  );
} 