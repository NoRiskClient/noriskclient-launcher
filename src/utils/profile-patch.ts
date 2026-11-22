import type { Profile, ProfilePatch } from "../types/profile";

export const TYPING_SAVE_DELAY_MS = 500;
export const SLIDER_SAVE_DELAY_MS = 300;

export function mergePatches(base: ProfilePatch, next: ProfilePatch): ProfilePatch {
  const settings = base.settings || next.settings ? { ...base.settings, ...next.settings } : undefined;
  return { ...base, ...next, ...(settings ? { settings } : {}) };
}

export function applyPatch(profile: Profile, patch: ProfilePatch): Profile {
  const { settings, ...fields } = patch;
  return { ...profile, ...fields, settings: { ...profile.settings, ...settings } };
}
