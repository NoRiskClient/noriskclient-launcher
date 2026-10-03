"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ClipTrimmer } from "./ClipTrimmer";
import {
  getClipDetails,
  samePath,
  trimClip,
  type ClipDetails,
  type TrackLevel,
} from "../../services/clip-service";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useThemeStore } from "../../store/useThemeStore";
import { useFontStore } from "../../store/font-store";

export interface EditorClip {
  path: string;
  name: string;
}

export function ClipEditorWindow({ initial }: { initial: EditorClip }) {
  const { t } = useTranslation();
  const [clip, setClip] = useState(initial);
  const [duration, setDuration] = useState(0);
  const [details, setDetails] = useState<ClipDetails | null>(null);
  const [saving, setSaving] = useState(false);
  const src = useMemo(() => convertFileSrc(clip.path), [clip.path]);
  const { confirm, confirmDialog } = useConfirmDialog();
  const editor = useRef({ dirty: false, busy: false });
  const switchTo = useRef<(next: EditorClip) => void>(() => {});

  useEffect(() => {
    const theme = useThemeStore.getState();
    theme.applyAccentColorToDOM();
    theme.applyBorderRadiusToDOM();
    useFontStore.getState().applyFontToDOM();
  }, []);

  useEffect(() => {
    switchTo.current = async (next: EditorClip) => {
      if (samePath(next.path, clip.path)) return;
      if (saving || editor.current.busy) {
        toast.error(t("clips.editor.switch.busy"));
        return;
      }
      if (editor.current.dirty) {
        const sure = await confirm({
          title: t("clips.editor.switch.title"),
          message: t("clips.editor.switch.message", { name: next.name }),
          confirmText: t("clips.editor.switch.confirm"),
          cancelText: t("clips.gallery.cancel"),
          type: "warning",
        });
        if (!sure) return;
      }
      editor.current = { dirty: false, busy: false };
      setClip(next);
    };
  });

  const track = useCallback((state: { dirty: boolean; busy: boolean }) => {
    editor.current = state;
  }, []);

  useEffect(() => {
    const opened = listen<EditorClip>("clip_editor_open", (event) => switchTo.current(event.payload));
    return () => void opened.then((stop) => stop());
  }, []);

  useEffect(() => {
    setDuration(0);
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
    let current = true;
    setDetails(null);
    void getClipDetails(clip.path)
      .then((loaded) => {
        if (current) setDetails(loaded);
      })
      .catch((e) => {
        console.warn("Could not read the clip's details", e);
      });
    return () => {
      current = false;
    };
  }, [clip.path]);

  const close = useCallback(() => void getCurrentWindow().close(), []);

  const save = useCallback(
    async (
      startSeconds: number,
      endSeconds: number,
      levels: TrackLevel[],
      videoStartSeconds: number | null,
      videoEndSeconds: number | null,
    ) => {
      setSaving(true);
      try {
        await trimClip(clip.path, startSeconds, endSeconds, levels, videoStartSeconds, videoEndSeconds);
        toast.success(t("clips.trim.saved"));
        close();
      } catch (e) {
        console.error("Could not trim the clip", e);
        toast.error(t("clips.trim.failed"));
      } finally {
        setSaving(false);
      }
    },
    [clip.path, close, t],
  );

  if (duration <= 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-black" data-tauri-drag-region>
        <Icon icon="svg-spinners:ring-resize" className="h-8 w-8 text-white/40" />
      </div>
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
        details={details}
        onCancel={close}
        onStateChange={track}
        onSave={save}
        t={t}
      />
      {confirmDialog}
    </>
  );
}
