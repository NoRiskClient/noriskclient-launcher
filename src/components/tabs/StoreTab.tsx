import { useEffect } from "react";
import { CapeBrowser } from '../capes/CapeBrowser';
import { setDiscordState } from "../../utils/discordRpc";

export function StoreTab() {
  useEffect(() => { setDiscordState("Browsing Capes"); }, []);

  return (
    <CapeBrowser />
  );
}
