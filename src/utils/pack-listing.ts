import type { NoriskPackDefinition, PackListing } from "../types/noriskPacks";

export type Packs = Record<string, NoriskPackDefinition>;

export interface PackOption {
  id: string;
  label: string;
  category: string;
  weight: number;
  hidden: boolean;
}

export interface PackGroup {
  category: string;
  items: PackOption[];
}

const DEFAULTS: Required<PackListing> = { category: "", weight: 0, hidden: false };

function toOption(id: string, def: NoriskPackDefinition): PackOption {
  const listing = { ...DEFAULTS, ...(def.listing ?? {}) };
  return {
    id,
    label: def.displayName || id,
    category: listing.category.trim(),
    weight: listing.weight,
    hidden: listing.hidden,
  };
}

export function packGroups(packs: Packs, selectedId?: string | null, showHidden = false): PackGroup[] {
  const options = Object.entries(packs)
    .map(([id, def]) => toOption(id, def))
    .filter((p) => showHidden || !p.hidden || p.id === selectedId)
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));

  const byCategory = new Map<string, PackOption[]>();
  for (const opt of options) {
    const list = byCategory.get(opt.category);
    if (list) list.push(opt);
    else byCategory.set(opt.category, [opt]);
  }

  return [...byCategory.entries()]
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => {
      const rank = Number(a.category !== "") - Number(b.category !== "");
      return rank || b.items[0].weight - a.items[0].weight || a.category.localeCompare(b.category);
    });
}

export function hasHiddenPacks(packs: Packs, selectedId?: string | null): boolean {
  return Object.entries(packs).some(([id, def]) => def.listing?.hidden && id !== selectedId);
}
