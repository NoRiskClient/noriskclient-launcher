import type { CosmeticCape } from "../../types/noriskCapes";

export const NO_CAPE_ID = "no-cape";

export function createNoCapePlaceholder(): CosmeticCape {
  return {
    _id: NO_CAPE_ID,
    accepted: true,
    uses: 0,
    firstSeen: "",
    moderatorMessage: "",
    creationDate: 0,
    elytra: false,
  };
}
