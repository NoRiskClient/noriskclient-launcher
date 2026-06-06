export interface Vec3Object {
  x: number;
  y: number;
  z: number;
}

export interface CosmeticSettings {
  color?: { red: number; green: number; blue: number } | null;
  scale?: number;
  previewScale?: number;
  offset?: Vec3Object;
  previewOffset?: Vec3Object;
  hash?: string | null;
  frames?: number;
  frameDelay?: number;
}

export interface CosmeticOutfit {
  _id: string;
  ownerId: string;
  name: string;
  cosmeticSettings: Record<string, CosmeticSettings>;
  skinId: string;
  customCapeHash?: string | null;
}

export interface CosmeticRealOutfit {
  outfit: CosmeticOutfit;
  ownedCosmetics: string[];
}

export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
