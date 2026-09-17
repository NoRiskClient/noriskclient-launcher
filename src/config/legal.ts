export type LegalLocale = "de" | "en";

export const LEGAL_DOCUMENT_URLS = {
  terms: { en: "https://norisk.gg/tos", de: "https://norisk.gg/de/agbs" },
  privacy: { en: "https://norisk.gg/privacy", de: "https://norisk.gg/de/datenschutzerklaerung" },
  licenses: { en: "https://norisk.gg/licenses", de: "https://norisk.gg/de/lizenzen" },
} satisfies Record<string, Record<LegalLocale, string>>;

export const legalLocale = (language: string | undefined): LegalLocale =>
  language?.startsWith("de") ? "de" : "en";

export const legalDocumentUrl = (slug: string, locale: LegalLocale): string | undefined =>
  LEGAL_DOCUMENT_URLS[slug as keyof typeof LEGAL_DOCUMENT_URLS]?.[locale];
