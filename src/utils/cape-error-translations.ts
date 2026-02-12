/**
 * Cape Error Translation Utility
 *
 * Translates backend cape rejection error keys into user-friendly messages.
 * The backend sends errors as JSON: {"translatableKey":"...", "args":[]}
 */

import i18n from '../i18n/i18n';

/**
 * Gets the translation for a cape error key
 */
function getCapeErrorTranslation(key: string): string | null {
  const translations: Record<string, string> = {
    "Inappropriate Content": i18n.t('capes.errors.inappropriate_content'),
    "Copyright": i18n.t('capes.errors.copyright'),
    "Incomplete": i18n.t('capes.errors.incomplete'),
    "In Review": i18n.t('capes.errors.in_review'),
    "Image does not fit the required resolution": i18n.t('capes.errors.resolution'),
    "nrc.cosmetics.custom_cape.error.no_hash_provided": i18n.t('capes.errors.no_hash'),
    "nrc.cosmetics.custom_cape.error.cape_not_found": i18n.t('capes.errors.not_found'),
    "nrc.cosmetics.custom_cape.error.deletion_not_allowed": i18n.t('capes.errors.deletion_not_allowed'),
    "nrc.cosmetics.custom_cape.error.max_cape_limit_reached": i18n.t('capes.errors.max_limit'),
    "nrc.cosmetics.custom_cape.error.not_a_favorite": i18n.t('capes.errors.not_favorite'),
    "nrc.core.error.user_not_found": i18n.t('capes.errors.user_not_found'),
  };
  return translations[key] || null;
}

/**
 * Interface for the API error response structure
 */
interface ApiErrorResponse {
  translatableKey: string;
  args?: string[];
}

/**
 * Attempts to parse a JSON error response and extract the translatable key
 * @param errorText The raw error text that might contain JSON
 * @returns The parsed ApiErrorResponse or null if parsing fails
 */
function parseApiErrorResponse(errorText: string): ApiErrorResponse | null {
  try {
    // Try to find JSON object in the error text
    const jsonMatch = errorText.match(/\{[\s\S]*"translatableKey"[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as ApiErrorResponse;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Translates a cape error key to a user-friendly message
 * @param key The error key to translate
 * @returns The translated message or the original key if no translation exists
 */
export function translateCapeErrorKey(key: string): string {
  return getCapeErrorTranslation(key) || key;
}

/**
 * Parses and translates a cape error response
 * Handles both JSON error responses and plain text errors
 * 
 * @param errorText The raw error text from the backend
 * @returns A user-friendly error message
 */
export function translateCapeError(errorText: string): string {
  // First, try to extract content after "Details:" if present
  const detailsIndex = errorText.indexOf("Details:");
  const relevantText = detailsIndex !== -1 
    ? errorText.substring(detailsIndex + 8).trim() 
    : errorText;
  
  // Try to parse as JSON API error response
  const parsedError = parseApiErrorResponse(relevantText);
  
  if (parsedError?.translatableKey) {
    const translated = translateCapeErrorKey(parsedError.translatableKey);
    
    // If we have args and the translation contains placeholders, substitute them
    if (parsedError.args && parsedError.args.length > 0) {
      let result = translated;
      parsedError.args.forEach((arg, index) => {
        result = result.replace(`{${index}}`, arg);
      });
      return result;
    }
    
    return translated;
  }
  
  // If not JSON, try direct translation of the text
  const directTranslation = getCapeErrorTranslation(relevantText);
  if (directTranslation) {
    return directTranslation;
  }
  
  // Return original text if no translation found (e.g., custom moderator reason)
  return relevantText;
}

/**
 * Checks if an error message indicates the cape is still in review
 * @param errorText The error text to check
 * @returns True if the cape is in review
 */
export function isCapeInReview(errorText: string): boolean {
  const lowerText = errorText.toLowerCase();
  return lowerText.includes("in review") || lowerText.includes("being reviewed");
}

