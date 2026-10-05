"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ClipTrimmer, WindowButton } from "./ClipTrimmer";
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
import { Button } from "../ui/buttons/Button";

const PROBE_TIMEOUT_MS = 15_000;

export function ClipEditorWindow() {
  const { t } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);
  const [clip, setClip] = useState<EditorClip | null>(null);
  const [duration, setDuration] = useState(0);
  const [details, setDetails] = useState<ClipDetails | null>(null);
  const [saving, setSaving] = useState(false);
  const [broken, setBroken] = useState(false);
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
    setBroken(false);
    if (!src) return;
    const probe = document.createElement("video");
    const fail = () => setBroken(true);
    const timeout = window.setTimeout(fail, PROBE_TIMEOUT_MS);
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      if (Number.isFinite(probe.duration) && probe.duration > 0) setDuration(probe.duration);
      else fail();
    };
    probe.onerror = () => {
      window.clearTimeout(timeout);
      fail();
    };
    probe.src = src;
    return () => {
      window.clearTimeout(timeout);
      probe.onloadedmetadata = null;
      probe.onerror = null;
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
      if (!path) return false;
      setSaving(true);
      try {
        await trimClip(path, startSeconds, endSeconds, levels, videoStartSeconds, videoEndSeconds);
        return true;
      } catch (e) {
        console.error("Could not trim the clip", e);
        toast.error(t("clips.trim.failed"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [path, t],
  );

  if (!clip || !src || duration <= 0) {
    return (
      <>
        <WindowFrame className="select-none [&_button_svg]:pointer-events-none">
          <header
            data-tauri-drag-region
            className="flex h-11 shrink-0 items-center gap-3 border-b border-white/5 bg-black/40 pl-4 pr-2"
          >
            <Icon
              icon="solar:videocamera-record-bold"
              className="pointer-events-none h-4 w-4 shrink-0"
              style={{ color: accent }}
            />
            <span
              data-tauri-drag-region
              className="min-w-0 flex-1 truncate font-minecraft text-xs normal-case tracking-wider"
              style={{ color: accent }}
            >
              {clip?.name}
            </span>
            <WindowButton icon="mdi:close" label={t("window.close")} danger onClick={closeNow} />
          </header>
          <div
            data-tauri-drag-region
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
          >
            {broken ? (
              <>
                <Icon icon="solar:videocamera-record-bold" className="pointer-events-none h-8 w-8 text-white/30" />
                <span className="pointer-events-none max-w-sm font-minecraft text-sm leading-relaxed text-white/70">
                  {t("clips.editor.load_failed")}
                </span>
                <Button variant="secondary" size="sm" onClick={closeNow}>
                  {t("common.close")}
                </Button>
              </>
            ) : (
              <>
                <Icon
                  icon="svg-spinners:ring-resize"
                  className="pointer-events-none h-7 w-7"
                  style={{ color: accent }}
                />
                <span className="pointer-events-none font-minecraft text-xs tracking-wider text-white/50">
                  {t("common.loading")}
                </span>
              </>
            )}
          </div>
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
        onStateChange={track}
        onSave={save}
        t={t}
      />
      {confirmDialog}
    </>
  );
}
