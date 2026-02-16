"use client";

import { useTranslation } from "react-i18next";
import { EmptyState } from "../ui/EmptyState";
import { TabLayout } from "../ui/TabLayout";

export function NewsTab() {
  const { t } = useTranslation();
  return (
    <TabLayout title={t('tabs.news')} icon="pixel:newspaper">
      <EmptyState message={t('news.coming_soon')} icon="pixel:newspaper" />
    </TabLayout>
  );
}
