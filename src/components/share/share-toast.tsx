import { toast } from "react-hot-toast";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import i18n from "../../i18n/i18n";
import { openExternalUrl } from "../../services/tauri-service";
import { uploadLog } from "../../services/log-service";
import { useThemeStore } from "../../store/useThemeStore";
import { getBorderRadiusClass } from "../ui/design-system";
import { logError } from "../../utils/logging-utils";

function openSharePage(url: string) {
  openExternalUrl(url).catch((e) => logError(`Could not open the share: ${e}`));
}

function OpenShareButton({ url, toastId }: { url: string; toastId: string }) {
  const borderRadius = useThemeStore((state) => state.borderRadius);
  return (
    <button
      type="button"
      onClick={() => {
        toast.dismiss(toastId);
        openSharePage(url);
      }}
      className={`shrink-0 border border-b-2 border-white/25 bg-white/10 px-3 py-1 font-smallcaps text-sm tracking-wider text-white transition-colors hover:border-white/40 hover:bg-white/20 ${getBorderRadiusClass(borderRadius)}`}
    >
      {i18n.t("share.open")}
    </button>
  );
}

export async function showShareSuccess(pageUrl: string, toastId?: string): Promise<void> {
  const copied = await writeText(pageUrl).then(
    () => true,
    () => false,
  );
  toast.success(
    (shown) => (
      <span className="flex items-center gap-3">
        <span>{i18n.t(copied ? "share.done_copied" : "share.done")}</span>
        <OpenShareButton url={pageUrl} toastId={shown.id} />
      </span>
    ),
    { id: toastId, duration: 10_000 },
  );
  openSharePage(pageUrl);
}

export async function shareLogWithToast(content: string, name: string): Promise<void> {
  const toastId = toast.loading(i18n.t("share.uploading_log"));
  try {
    await showShareSuccess(await uploadLog(content, name), toastId);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e), { id: toastId, duration: 6_000 });
  }
}
