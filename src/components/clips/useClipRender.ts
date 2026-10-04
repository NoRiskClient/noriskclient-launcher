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
import { useClipEngineEvents } from "./useClipEngineEvents";
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
  const renderingRef = useRef(false);

  const finish = useCallback(() => {
    renderingRef.current = false;
    setRendering(null);
  }, []);

  useClipEngineEvents({
    clip_export_progress: (progress) => {
      if (!renderingRef.current || !samePath(progress.source, path)) return;
      setRendering({ done: progress.done, total: progress.total });
    },
    clip_exported: (clip) => {
      if (!renderingRef.current || !samePath(clip.source, path)) return;
      finish();
      toast.success(t("clips.trim.saved"));
      onDone();
    },
    clip_engine_stopped: () => {
      if (!renderingRef.current) return;
      finish();
      toast.error(t("clips.trim.failed"));
    },
    clip_error: (error) => {
      if (!renderingRef.current) return;
      if (error.code !== "clip_write" && error.code !== "protocol") return;
      finish();
      toast.error(t("clips.trim.failed"));
    },
  });

  const save = useCallback(
    async (edit: ClipEdit) => {
      if (
        edit.overlays.length === 0 &&
        edit.shape === "original" &&
        edit.removed.length === 0 &&
        edit.blanked.length === 0 &&
        edit.hushed.length === 0
      ) {
        if (await onTrim(edit.start, edit.end, edit.levels, edit.videoStart, edit.videoEnd)) onDone();
        return;
      }
      renderingRef.current = true;
      setRendering({ done: 0, total: 0 });
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
    [finish, onDone, onTrim, path],
  );

  const percent =
    rendering && rendering.total > 0 ? Math.round((rendering.done / rendering.total) * 100) : null;

  return { rendering: rendering !== null, percent, save };
}
