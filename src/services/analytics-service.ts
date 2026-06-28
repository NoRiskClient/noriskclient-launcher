import { invoke } from '@tauri-apps/api/core';
import { getOrCreateInstallId } from './install-id-service';

interface AnalyticsEvent {
    event_type: string;
    timestamp: string;
    session_id: string;
    user_id: string;
    properties?: Record<string, any>;
}

let sessionId: string | null = null;
let userId: string | null = null;
let analyticsEnabled: boolean | null = null;

export const initializeAnalytics = async (): Promise<void> => {
    sessionId = generateSessionId();
    userId = getOrCreateInstallId();
};

export const invalidateAnalyticsCache = (): void => {
    analyticsEnabled = null;
};

const checkAnalyticsEnabled = async (): Promise<boolean> => {
    try {
        if (analyticsEnabled === null) {
            const config: any = await invoke('get_launcher_config');
            analyticsEnabled = config.enable_analytics || false;
        }
        return analyticsEnabled;
    } catch (error) {
        console.warn('[Analytics] Failed to check config, defaulting to disabled:', error);
        return false;
    }
};

const generateSessionId = (): string =>
    `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const trackEvent = async (
    eventType: string,
    properties?: Record<string, any>,
): Promise<void> => {
    try {
        const enabled = await checkAnalyticsEnabled();
        if (!enabled) return;

        if (!sessionId || !userId) {
            await initializeAnalytics();
        }

        const event: AnalyticsEvent = {
            event_type: eventType,
            timestamp: new Date().toISOString(),
            session_id: sessionId!,
            user_id: userId!,
            properties,
        };

        await invoke('track_analytics_event', { event });
    } catch (error) {
        console.error('[Analytics] Failed to track event:', eventType, error);
    }
};
