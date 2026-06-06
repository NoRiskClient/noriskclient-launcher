import { useEffect, useState } from "react";

import {
  getSelectedIcon,
  type SelectedIcon,
} from "../services/cosmetic-icon-service";

const EMPTY: SelectedIcon = { url: null, plus: false };

export function useSelectedIcon(
  playerIdentifier: string | null | undefined
): SelectedIcon {
  const [icon, setIcon] = useState<SelectedIcon>(EMPTY);

  useEffect(() => {
    if (!playerIdentifier) {
      setIcon(EMPTY);
      return;
    }
    let alive = true;
    getSelectedIcon(playerIdentifier).then((res) => {
      if (alive) setIcon(res);
    });
    return () => {
      alive = false;
    };
  }, [playerIdentifier]);

  return icon;
}
