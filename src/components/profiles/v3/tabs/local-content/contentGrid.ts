import type { LocalContentItem } from "../../../../../hooks/useLocalContentManager";
import { isSyncModLive, syncModKey, type ProfileSyncPackMod } from "../../../../../types/syncPacks";

export type GridEntry<T> =
  | { kind: "local"; item: T }
  | { kind: "sync"; entry: ProfileSyncPackMod };

export interface EntryGroup<T> {
  id: string;
  label: string;
  packId?: string;
  packIcon?: string | null;
  entries: GridEntry<T>[];
}

export function localItemKey(item: LocalContentItem): string {
  return item.path_str || item.filename;
}

export function gridEntryKey<T extends LocalContentItem>(entry: GridEntry<T>): string {
  return entry.kind === "local" ? localItemKey(entry.item) : syncModKey(entry.entry);
}

export function filterSyncMods(
  mods: ProfileSyncPackMod[],
  filter: string,
  query: string,
): ProfileSyncPackMod[] {
  let list: ProfileSyncPackMod[];
  switch (filter) {
    case "all":
    case "fromSyncPack":
      list = mods;
      break;
    case "enabled":
      list = mods.filter(isSyncModLive);
      break;
    case "disabled":
      list = mods.filter((entry) => !isSyncModLive(entry));
      break;
    default:
      return [];
  }
  const needle = query.trim().toLowerCase();
  return needle
    ? list.filter(
        (entry) =>
          entry.display_name.toLowerCase().includes(needle) ||
          entry.pack_name.toLowerCase().includes(needle),
      )
    : list;
}

export function mergeGridEntries<T>(
  items: T[],
  syncMods: ProfileSyncPackMod[],
  nameOf: ((item: T) => string) | null,
): GridEntry<T>[] {
  const entries: GridEntry<T>[] = [
    ...items.map((item): GridEntry<T> => ({ kind: "local", item })),
    ...syncMods.map((entry): GridEntry<T> => ({ kind: "sync", entry })),
  ];
  if (!nameOf) return entries;
  const labelOf = (entry: GridEntry<T>) =>
    entry.kind === "local" ? nameOf(entry.item) : entry.entry.display_name;
  return entries.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
}

export function groupGridEntries<T>(entries: GridEntry<T>[], profileLabel: string): EntryGroup<T>[] {
  const profileGroup: EntryGroup<T> = { id: "profile", label: profileLabel, entries: [] };
  const packGroups = new Map<string, EntryGroup<T>>();
  for (const entry of entries) {
    if (entry.kind === "local") {
      profileGroup.entries.push(entry);
      continue;
    }
    const { pack_id, pack_name, pack_icon } = entry.entry;
    let group = packGroups.get(pack_id);
    if (!group) {
      group = { id: `pack:${pack_id}`, label: pack_name, packId: pack_id, packIcon: pack_icon, entries: [] };
      packGroups.set(pack_id, group);
    }
    group.entries.push(entry);
  }
  return [profileGroup, ...packGroups.values()].filter((group) => group.entries.length > 0);
}
