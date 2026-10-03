"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ClipTrimmer } from "./ClipTrimmer";
import {
  closeClipEditor,
  getClipDetails,
  getEditorClip,
  trimClip,
  type ClipDetails,
  type EditorClip,
  type TrackLevel,
} from "../../services/clip-service";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useThemeStore } from "../../store/useThemeStore";
import { useFontStore } from "../../store/font-store";
import { WindowFrame } from "../ui/WindowFrame";

export function ClipEditorWindow() {
  const { t } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);
  const [clip, setClip] = useState<EditorClip | null>(null);
  const [duration, setDuration] = useState(0);
  const [details, setDetails] = useState<ClipDetails | null>(null);
  const [saving, setSaving] = useState(false);
  const path = clip?.path ?? null;
  const src = useMemo(() => (path ? convertFileSrc(path) : null), [path]);
  const { confirm, confirmDialog, isOpen: dialogOpen } = useConfirmDialog();
  const editor = useRef({ dirty: false, busy: false });
  const switchTo = useRef<(next: EditorClip) => void>(() => {});
  const leave = useRef<() => void>(() => {});
  const asking = useRef(false);

  useEffect(() => {
    const theme = useThemeStore.getState();
    theme.applyAccentColorToDOM();
    theme.applyBorderRadiusToDOM();
    useFontStore.getState().applyFontToDOM();
  }, []);

  const closeNow = useCallback(() => {
    closeClipEditor().catch((e) => console.error("Could not close the clip editor", e));
  }, []);

  useEffect(() => {
    switchTo.current = async (next: EditorClip) => {
      if (next.path === path) return;
      if (saving || editor.current.busy) {
        toast.error(t("clips.editor.switch.busy"));
        return;
      }
      if (editor.current.dirty) {
        const sure = await confirm({
          title: t("clips.editor.switch.title"),
          message: t("clips.editor.switch.message", { name: next.name }),
          confirmText: t("clips.editor.switch.confirm"),
          cancelText: t("clips.editor.keep_editing"),
          type: "danger",
          icon: "solar:videocamera-record-bold",
        });
        if (!sure) return;
      }
      editor.current = { dirty: false, busy: false };
      setClip(next);
    };

    leave.current = async () => {
      if (asking.current) return;
      if (editor.current.dirty) {
        asking.current = true;
        const sure = await confirm({
          title: t("clips.editor.close.title"),
          message: t("clips.editor.close.message"),
          confirmText: t("clips.editor.close.discard"),
          cancelText: t("clips.editor.keep_editing"),
          type: "danger",
          icon: "solar:close-circle-bold",
        }).finally(() => {
          asking.current = false;
        });
        if (!sure) return;
      }
      closeNow();
    };
  });

  const track = useCallback((state: { dirty: boolean; busy: boolean }) => {
    editor.current = state;
  }, []);

  useEffect(() => {
    const opened = listen<EditorClip>("clip_editor_open", (event) => switchTo.current(event.payload));
    void getEditorClip()
      .then((current) => {
        if (current) setClip((shown) => shown ?? current);
      })
      .catch((e) => console.error("Could not read which clip to edit", e));
    return () => void opened.then((stop) => stop());
  }, []);

  useEffect(() => {
    const requested = getCurrentWindow().listen(TauriEvent.WINDOW_CLOSE_REQUESTED, () => leave.current());
    return () => void requested.then((stop) => stop());
  }, []);

  useEffect(() => {
    setDuration(0);
    if (!src) return;
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => setDuration(probe.duration);
    probe.src = src;
    return () => {
      probe.onloadedmetadata = null;
      probe.removeAttribute("src");
      probe.load();
    };
  }, [src]);

  useEffect(() => {
    setDetails(null);
    if (!path) return;
    let current = true;
    void getClipDetails(path)
      .then((loaded) => {
        if (current) setDetails(loaded);
      })
      .catch((e) => {
        console.warn("Could not read the clip's details", e);
      });
    return () => {
      current = false;
    };
  }, [path]);

  const close = useCallback(() => leave.current(), []);

  const save = useCallback(
    async (
      startSeconds: number,
      endSeconds: number,
      levels: TrackLevel[],
      videoStartSeconds: number | null,
      videoEndSeconds: number | null,
    ) => {
      if (!path) return;
      setSaving(true);
      try {
        await trimClip(path, startSeconds, endSeconds, levels, videoStartSeconds, videoEndSeconds);
        toast.success(t("clips.trim.saved"));
        closeNow();
      } catch (e) {
        console.error("Could not trim the clip", e);
        toast.error(t("clips.trim.failed"));
      } finally {
        setSaving(false);
      }
    },
    [path, closeNow, t],
  );

  if (!clip || !src || duration <= 0) {
    return (
      <>
        <WindowFrame className="select-none items-center justify-center" data-tauri-drag-region>
          <Icon
            icon="svg-spinners:ring-resize"
            className="pointer-events-none mb-3 h-7 w-7"
            style={{ color: accent }}
          />
          <span className="pointer-events-none font-minecraft text-xs tracking-wider text-white/50">
            {t("common.loading")}
          </span>
        </WindowFrame>
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <ClipTrimmer
        key={clip.path}
        src={src}
        path={clip.path}
        name={clip.name}
        duration={duration}
        busy={saving}
        paused={dialogOpen}
        details={details}
        onCancel={close}
        onDone={closeNow}
        onStateChange={track}
        onSave={save}
        t={t}
      />
      {confirmDialog}
    </>
  );
}
