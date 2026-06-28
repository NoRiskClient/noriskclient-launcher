"use client";

import { useEffect } from "react";
import { TabHeader } from "../ui/TabHeader";
import { TabContent } from "../ui/TabContent";
// import { EmptyState } from "../ui/EmptyState"; // Replaced by CapeBrowser
import { CapeBrowser } from '../capes/CapeBrowser';
import { setDiscordState } from "../../utils/discordRpc";

export function StoreTab() {
  useEffect(() => { setDiscordState("Browsing Capes"); }, []);

  return (
    <CapeBrowser />
  );
}
