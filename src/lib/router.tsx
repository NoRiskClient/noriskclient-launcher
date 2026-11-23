import { createHashRouter, Navigate } from "react-router-dom";
import { App } from "../App";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";
import { PlayTab } from "../components/tabs/PlayTab";
// DISABLED: Advent Calendar (seasonal feature)
// import { AdventCalendarTab } from "../components/advent-calendar/AdventCalendarTab";

const profileDetail = async () => ({
  Component: (await import("../components/profiles/ProfileDetailViewV2Wrapper")).ProfileDetailViewV2Wrapper,
});

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
        path: "profiles",
        lazy: async () => ({
          Component: (await import("../components/tabs/ProfilesTabV2")).ProfilesTabV2,
        }),
      },
      {
        path: "profilesv2/:profileId",
        lazy: profileDetail,
      },
      {
        path: "profiles/:profileId",
        lazy: profileDetail,
      },
      {
        path: "sync-packs",
        lazy: async () => ({
          Component: (await import("../components/sync-packs/SyncPacksPage")).SyncPacksPage,
        }),
      },
      {
        path: "mods",
        lazy: async () => ({
          Component: (await import("../components/tabs/ModrinthTabV2")).ModrinthTabV2,
        }),
      },
      {
        path: "mods/:source/:projectId",
        lazy: async () => ({
          Component: (await import("../components/mods/ModDetailPage")).ModDetailPage,
        }),
      },
      {
        path: "skins",
        lazy: async () => ({
          Component: (await import("../components/tabs/SkinsTab")).SkinsTab,
        }),
      },
      {
        path: "capes",
        lazy: async () => ({
          Component: (await import("../components/tabs/StoreTab")).StoreTab,
        }),
      },
      {
        path: "clips",
        lazy: async () => ({
          Component: (await import("../components/tabs/ClipsPage")).ClipsPage,
        }),
      },
      // DISABLED: Advent Calendar (seasonal feature)
      // {
      //   path: "advent-calendar",
      //   element: <AdventCalendarTab />,
      // },
    ],
  },
]);

