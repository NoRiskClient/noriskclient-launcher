import {
  getSelectedIcon,
  type SelectedIcon,
} from "../services/cosmetic-icon-service";
import { useAsyncResource } from "./useAsyncResource";

const EMPTY: SelectedIcon = { url: null, plus: false };

export function useSelectedIcon(
  playerIdentifier: string | null | undefined
): SelectedIcon {
  const { data } = useAsyncResource<SelectedIcon>(
    playerIdentifier ? () => getSelectedIcon(playerIdentifier) : null,
    [playerIdentifier],
    EMPTY,
  );

  return data;
}
