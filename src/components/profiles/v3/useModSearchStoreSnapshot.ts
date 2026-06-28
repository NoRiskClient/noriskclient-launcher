import { useEffect, useRef } from "react";
import type { ModrinthProjectType } from "../../../types/modrinth";
import type { UnifiedSortType } from "../../../types/unified";
import { useModSearchStore } from "../../../store/useModSearchStore";

/**
 * Snapshot/restore wrapper for the global `useModSearchStore`.
 *
 * Why: `ModrinthSearchV2` auto-applies the selected profile's `game_version`
 * / `loader` to the global search store (see `ModrinthSearchV2.tsx:1410`).
 * That's fine while the user is inside the profile's add-content flow, but
 * it leaks into the standalone `/mods` tab — open a 1.7 Forge profile's
 * add-mods sheet, close it, navigate to /mods, and you're still filtered to
 * 1.7 + Forge. The store even persists to `sessionStorage` so the leak
 * survives reloads.
 *
 * While `active` is true we hold a snapshot taken at the moment of
 * activation; when `active` flips false (or the hook unmounts) we restore
 * the snapshot onto the store. The store itself is untouched — callers of
 * the standalone tab keep their existing filter-persistence behavior.
 */

interface Snapshot {
  projectType: ModrinthProjectType;
  searchTerm: string;
  sortOrder: UnifiedSortType;
  selectedGameVersions: string[];
  selectedLoadersByProjectType: Record<ModrinthProjectType, string[]>;
  selectedCategoriesByProjectType: Record<ModrinthProjectType, string[]>;
  filterClientRequired: boolean;
  filterServerRequired: boolean;
}

export function useModSearchStoreSnapshot(active: boolean) {
  const snapshotRef = useRef<Snapshot | null>(null);

  useEffect(() => {
    if (!active) return;
    const s = useModSearchStore.getState();
    snapshotRef.current = {
      projectType: s.projectType,
      searchTerm: s.searchTerm,
      sortOrder: s.sortOrder,
      // Clone collection fields — the store mutates via spread in its setters
      // but we want our snapshot immune to any in-flight updates.
      selectedGameVersions: [...s.selectedGameVersions],
      selectedLoadersByProjectType: { ...s.selectedLoadersByProjectType },
      selectedCategoriesByProjectType: { ...s.selectedCategoriesByProjectType },
      filterClientRequired: s.filterClientRequired,
      filterServerRequired: s.filterServerRequired,
    };
    return () => {
      const snap = snapshotRef.current;
      if (!snap) return;
      const store = useModSearchStore.getState();
      store.setProjectType(snap.projectType);
      store.setSearchTerm(snap.searchTerm);
      store.setSortOrder(snap.sortOrder);
      store.setSelectedGameVersions(snap.selectedGameVersions);
      store.setSelectedLoadersByProjectType(snap.selectedLoadersByProjectType);
      store.setSelectedCategoriesByProjectType(snap.selectedCategoriesByProjectType);
      store.setFilterClientRequired(snap.filterClientRequired);
      store.setFilterServerRequired(snap.filterServerRequired);
      snapshotRef.current = null;
    };
  }, [active]);
}
