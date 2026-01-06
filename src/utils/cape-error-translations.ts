/**
 * Cape Error Translation Utility
 * 
 * Translates backend cape rejection error keys into user-friendly messages.
 * The backend sends errors as JSON: {"translatableKey":"...", "args":[]}
 */

/**
 * Translation map for known cape error keys
 */
const CAPE_ERROR_TRANSLATIONS: Record<string, string> = {
  // Moderator denial reasons (from ButtonManager.kt)
  "Inappropriate Content": "Your cape was rejected because it contains inappropriate content.",
  "Copyright": "Your cape was rejected due to copyright infringement.",
  "Incomplete": "Your cape was rejected because the design is incomplete.",
  
  // Static message for custom reason
  "Custom Reason": "Your cape was rejected: {0}",
  
  // Static messages (from CosmeticCapeRoute.kt)
  "In Review": "Your cape is currently being reviewed. Please be patient.",
  "Image does not fit the required resolution": "Your cape image must be 512x256 pixels.",
  
  // nrcError keys (from CosmeticCapeRoute.kt)
  "nrc.cosmetics.custom_cape.error.no_hash_provided": "No cape identifier was provided.",
  "nrc.cosmetics.custom_cape.error.cape_not_found": "The requested cape could not be found.",
  "nrc.cosmetics.custom_cape.error.deletion_not_allowed": "You are not authorized to delete this cape.",
  "nrc.cosmetics.custom_cape.error.max_cape_limit_reached": "You have reached the maximum number of favorite capes.",
  "nrc.cosmetics.custom_cape.error.not_a_favorite": "This cape is not in your favorites.",
  "nrc.core.error.user_not_found": "User not found.",
};

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
  return CAPE_ERROR_TRANSLATIONS[key] || key;
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
    
    // Custom reason will also be in translatableKey
    if(translated == parsedError.translatableKey) {
      return translateCapeErrorKey("Custom Reason").replace("{0}", parsedError.translatableKey);
    }
    
    return translated;
  }
  
  // If not JSON, try direct translation of the text
  const directTranslation = CAPE_ERROR_TRANSLATIONS[relevantText];
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

