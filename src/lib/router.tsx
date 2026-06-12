import { createHashRouter, Navigate } from "react-router-dom";
import { App } from "../App";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";
import { PlayTab } from "../components/tabs/PlayTab";
import { ProfilesTab } from "../components/tabs/ProfilesTab";
import ModrinthTabV2 from "../components/tabs/ModrinthTabV2";
import { SkinsTab } from "../components/tabs/SkinsTab";
import { ServersTab } from "../components/tabs/ServersTab";
import { AiTab } from "../components/tabs/AiTab";
import { StoreTab } from "../components/tabs/StoreTab";
import { SettingsTab } from "../components/tabs/SettingsTab";
import { BrowseTab } from "../components/profiles/detail/BrowseTab";
import { BrowseTabWrapper } from "../components/profiles/BrowseTabWrapper";
import { ProfilesTabV2 } from "../components/tabs/ProfilesTabV2";
import { ProfileDetailViewV2Wrapper } from "../components/profiles/ProfileDetailViewV2Wrapper";
// DISABLED: Advent Calendar (seasonal feature)
// import { AdventCalendarTab } from "../components/advent-calendar/AdventCalendarTab";
import { ModDetailPage } from "../components/mods/ModDetailPage";
import { BedrockProfileDetailView } from "../components/profiles/BedrockProfileDetailView";

export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <Navigate to="/play" replace />,
      },
      {
        path: "play",
        element: <PlayTab />,
      },
      {
        path: "profiles/:profileId",
        element: <ProfilesTab />,
      },
      {
        path: "profilesv2/:profileId",
        element: <ProfileDetailViewV2Wrapper />,
      },
      {
        path: "profilesv2/:profileId/browse/:contentType",
        element: <BrowseTabWrapper />,
      },
      {
        path: "profiles",
        element: <ProfilesTabV2 />,
      },
      {
        path: "bedrock-profiles/:profileId",
        element: <BedrockProfileDetailView />,
      },
      {
        path: "profiles/:profileId/browse/:contentType",
        element: <BrowseTab />,
      },
      {
        path: "mods",
        element: <ModrinthTabV2 />,
      },
      {
        path: "servers",
        element: <ServersTab />,
      },
      {
        path: "mods/:source/:projectId",
        element: <ModDetailPage />,
      },
      {
        path: "skins",
        element: <SkinsTab />,
      },
      {
        path: "capes",
        element: <StoreTab />,
      },
      {
        path: "ai",
        element: <AiTab />,
      },
      {
        path: "settings",
        element: <SettingsTab />,
      },
      // DISABLED: Advent Calendar (seasonal feature)
      // {
      //   path: "advent-calendar",
      //   element: <AdventCalendarTab />,
      // },
    ],
  },
]);
