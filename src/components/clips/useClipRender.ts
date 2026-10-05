import { useCallback, useRef, useState } from "react";
import { toast } from "react-hot-toast";

import {
  exportVertical,
  samePath,
  type ClipOverlay,
  type ClipShape,
  type Span,
  type TrackCut,
  type TrackLevel,
} from "../../services/clip-service";
import { parseErrorMessage } from "../../utils/error-utils";
import { useClipEngineEvents, writeFailed } from "./useClipEngineEvents";
import type { Translate } from "./editor/shared";

interface RenderProgress {
  done: number;
  total: number;
}

export interface ClipEdit {
  overlays: ClipOverlay[];
  shape: ClipShape;
  start: number;
  end: number;
  levels: TrackLevel[];
  videoStart: number | null;
  videoEnd: number | null;
  removed: Span[];
  blanked: Span[];
  hushed: TrackCut[];
}

interface Options {
  path: string;
  onDone: () => void;
  onTrim: (
    startSeconds: number,
    endSeconds: number,
    levels: TrackLevel[],
    videoStartSeconds: number | null,
    videoEndSeconds: number | null,
  ) => Promise<boolean>;
  t: Translate;
}

export function useClipRender({ path, onDone, onTrim, t }: Options) {
  const [rendering, setRendering] = useState<RenderProgress | null>(null);
  const job = useRef<"trim" | "export" | null>(null);

  const finish = useCallback(() => {
    job.current = null;
    setRendering(null);
  }, []);

  const succeed = () => {
    finish();
    toast.success(t("clips.trim.saved"));
    onDone();
  };

  const fail = () => {
    finish();
    toast.error(t("clips.trim.failed"));
  };

  useClipEngineEvents({
    clip_export_progress: (progress) => {
      if (job.current !== "export" || !samePath(progress.source, path)) return;
      setRendering({ done: progress.done, total: progress.total });
    },
    clip_exported: (clip) => {
      if (job.current === "export" && samePath(clip.source, path)) succeed();
    },
    clip_trimmed: (clip) => {
      if (job.current === "trim" && samePath(clip.source, path)) succeed();
    },
    clip_engine_stopped: () => {
      if (job.current) fail();
    },
    clip_error: (error) => {
      if (job.current && writeFailed(error, path)) fail();
    },
  });

  const save = useCallback(
    async (edit: ClipEdit) => {
      setRendering({ done: 0, total: 0 });
      if (
        edit.overlays.length === 0 &&
        edit.shape === "original" &&
        edit.removed.length === 0 &&
        edit.blanked.length === 0 &&
        edit.hushed.length === 0
      ) {
        job.current = "trim";
        if (!(await onTrim(edit.start, edit.end, edit.levels, edit.videoStart, edit.videoEnd))) finish();
        return;
      }
      job.current = "export";
      try {
        await exportVertical(path, edit.shape, edit.overlays, {
          startSeconds: edit.start,
          endSeconds: edit.end,
          levels: edit.levels,
          videoStartSeconds: edit.videoStart,
          videoEndSeconds: edit.videoEnd,
          removed: edit.removed,
          blanked: edit.blanked,
          muted: edit.hushed,
        });
      } catch (e) {
        console.error("Could not render the clip", e);
        finish();
        toast.error(parseErrorMessage(e));
      }
    },
    [finish, onTrim, path],
  );

  const percent =
    rendering && rendering.total > 0 ? Math.round((rendering.done / rendering.total) * 100) : null;

  return { rendering: rendering !== null, percent, save };
}
