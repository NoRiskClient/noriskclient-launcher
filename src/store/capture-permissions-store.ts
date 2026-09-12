import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  getCapturePermissions,
  type CapturePermission,
  type CapturePermissions,
} from "../services/clip-service";
import { parseErrorMessage } from "../utils/error-utils";
import { useClipsStore } from "./clips-store";

export const capturePermissionKeys: CapturePermission[] = [
  "screen_recording",
  "input_monitoring",
  "microphone",
];
export const requiredCapturePermissions = (
  permissions: CapturePermissions,
): CapturePermission[] =>
  capturePermissionKeys.filter(
    (key) => key !== "microphone" || permissions.microphone_required,
  );
export const allCapturePermissionsGranted = (
  permissions: CapturePermissions | null,
) =>
  permissions !== null &&
  requiredCapturePermissions(permissions).every((key) => permissions[key]);

type Notice = {
  reason: "denied" | "revoked" | "missing";
  permissions: CapturePermission[];
};
interface State {
  permissions: CapturePermissions | null;
  previous: CapturePermissions | null;
  requested: CapturePermission[];
  busy: string | null;
  error: string | null;
  notice: Notice | null;
  check: (request?: CapturePermission) => Promise<void>;
  dismiss: () => void;
}

export const useCapturePermissionsStore = create<State>()(
  persist(
    (set, get) => ({
      permissions: null,
      previous: null,
      requested: [],
      busy: null,
      error: null,
      notice: null,
      dismiss: () => set({ notice: null }),
      check: async (request) => {
        if (get().busy) return;
        const before = get().previous;
        const firstCheck = get().permissions === null;
        set({ busy: request ?? "refresh" });
        try {
          const permissions = await getCapturePermissions(request);
          if (!permissions)
            throw new Error("macOS capture permissions are unavailable.");
          const required = requiredCapturePermissions(permissions);
          const revoked = required.filter(
            (key) => before?.[key] && !permissions[key],
          );
          const missing = required.filter((key) => !permissions[key]);
          const denied = missing.filter(
            (key) =>
              get().requested.includes(key) ||
              (key === "microphone" && permissions.microphone_denied),
          );
          let notice = get().notice;
          if (revoked.length)
            notice = { reason: "revoked", permissions: revoked };
          else if (request && !permissions[request])
            notice = { reason: "denied", permissions: [request] };
          else if (firstCheck && denied.length)
            notice = { reason: "denied", permissions: denied };
          else if (
            firstCheck &&
            missing.length &&
            useClipsStore.getState().enabled
          )
            notice = { reason: "missing", permissions: missing };
          if (notice) {
            const remaining = notice.permissions.filter(
              (key) => !permissions[key],
            );
            notice = remaining.length
              ? { ...notice, permissions: remaining }
              : null;
          }
          set({
            permissions,
            previous: permissions,
            notice,
            error: null,
            requested: [
              ...new Set([
                ...get().requested,
                ...capturePermissionKeys.filter((key) => permissions[key]),
                ...(request ? [request] : []),
              ]),
            ],
          });
        } catch (error) {
          set({ permissions: null, error: parseErrorMessage(error) });
        } finally {
          set({ busy: null });
        }
      },
    }),
    {
      name: "capture-permission-history",
      partialize: ({ previous, requested }) => ({ previous, requested }),
    },
  ),
);
