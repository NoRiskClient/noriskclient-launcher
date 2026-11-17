/**
 * NoRisk API Error Translation
 *
 * The backend returns error bodies shaped like `{"translatableKey":"...","args":[...]}`.
 * Tauri commands now surface these as a structured `CommandError`
 * (`{ message, kind, translatable_key?, args?, status? }`, see src-tauri error.rs).
 *
 * This helper resolves such an error into a user-facing, translated string:
 *   1. structured `translatable_key` + `args` (preferred)
 *   2. a `{translatableKey,...}` JSON body still embedded in the message (legacy path)
 *   3. a caller-supplied fallback / the raw message
 */

import i18n from '../i18n/i18n';
import { parseErrorMessage } from './error-utils';

export interface NrcCommandError {
  message?: string;
  kind?: string;
  translatable_key?: string;
  args?: string[];
  status?: number;
}

function interpolate(key: string, args?: string[]): string {
  const opts: Record<string, string> = {};
  (args ?? []).forEach((arg, index) => {
    opts[String(index)] = arg;
  });
  return i18n.t(key, opts);
}

function extractEmbeddedKey(text: string): { translatableKey: string; args?: string[] } | null {
  const match = text.match(/\{[\s\S]*"translatableKey"[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed && typeof parsed.translatableKey === 'string') {
      return parsed;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/**
 * Resolve a Tauri command error into a translated, user-facing message.
 * @param error   The rejected value from `invoke(...)` (a CommandError, string, or unknown).
 * @param fallback An already-translated string to show when nothing better can be resolved.
 */
export function translateApiError(error: unknown, fallback?: string): string {
  const err = error as NrcCommandError | string | undefined;

  if (err && typeof err === 'object' && err.translatable_key) {
    return interpolate(err.translatable_key, err.args);
  }

  const raw = parseErrorMessage(error);
  const embedded = extractEmbeddedKey(raw);
  if (embedded) {
    return interpolate(embedded.translatableKey, embedded.args);
  }

  return fallback ?? raw;
}
