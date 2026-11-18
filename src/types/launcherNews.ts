export interface LocalizedText {
  en: string;
  de: string;
}

export interface LauncherNewsItem {
  id: string;
  thumbnailUrl: string;
  url: LocalizedText | null;
  title: LocalizedText;
  publishedAt: number;
}

export interface LauncherNewsPage {
  items: LauncherNewsItem[];
  page: number;
  totalPages: number;
}

export type NewsLocale = keyof LocalizedText;

export const newsLocale = (language: string | undefined): NewsLocale =>
  language?.startsWith("de") ? "de" : "en";
