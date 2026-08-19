"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";

import { Select } from "../../ui/Select";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { RangeSlider } from "../../ui/RangeSlider";
import { SettingsSection } from "../../ui/settings/SettingsSection";
import { SettingRow } from "../../ui/settings/SettingRow";
import { useSettingsConfig, useSettingsKeywords } from "./settings-context";

import { HotkeyInput } from "../../ui/HotkeyInput";
import { ClipGallery } from "../../clips/ClipGallery";
import {
  getCaptureStatus,
  getEncoderCapabilities,
  applyClipSettings,
  releaseHotkeys,
  openClipFolder,
} from "../../../services/clip-service";
import type {
  AudioDeviceInfo,
  AudioSourceChoice,
  CaptureStatus,
  ClipCodec,
  ClipConfig,
  ClipEncoder,
  EncoderCapability,
  QualityPreset,
  QualitySpec,
} from "../../../types/launcherConfig";
import {
  CUSTOM_BITRATES_KBPS,
  CUSTOM_FPS,
  CUSTOM_RESOLUTIONS,
  QUALITY_PRESETS,
} from "../../../types/launcherConfig";
import { cn } from "../../../lib/utils";

const PRESET_ORDER: QualityPreset[] = ["low", "standard", "high", "custom"];

const DEFAULT_DEVICE = "__default__";
const CODEC_ORDER: ClipCodec[] = ["h264", "h265", "av1"];

const AUDIO_KBPS = 160;

const MIN_CLIP_SECONDS = 5;
const MAX_CLIP_SECONDS = 120;
const BUFFER_HEADROOM_SECONDS = 5;

function effectiveSpec(clips: ClipConfig): QualitySpec {
  const preset = clips.quality ?? "custom";
  if (preset !== "custom") return QUALITY_PRESETS[preset];
  return {
    width: clips.width,
    height: clips.height,
    fps: clips.fps,
    bitrateKbps: clips.bitrate_kbps,
  };
}

function clipLengthSeconds(clips: ClipConfig): number {
  return Math.min(Math.max(clips.pre_roll_seconds, MIN_CLIP_SECONDS), MAX_CLIP_SECONDS);
}

function estimatedBufferMb(clips: ClipConfig): number {
  const spec = effectiveSpec(clips);
  const kbps = spec.bitrateKbps + (clips.capture_audio ? AUDIO_KBPS : 0);
  const seconds = clipLengthSeconds(clips) + BUFFER_HEADROOM_SECONDS;
  return Math.round((kbps * seconds) / 8 / 1000);
}

function hotkeySignature(clips: ClipConfig): string {
  return `${clips.enabled}|${clips.hotkey_save}|${clips.hotkey_toggle}`;
}

function resolutionLabel(spec: QualitySpec): string {
  const match = CUSTOM_RESOLUTIONS.find(
    (r) => r.width === spec.width && r.height === spec.height,
  );
  return match ? match.label : `${spec.width} × ${spec.height}`;
}

export function ClipsTab() {
  const { t } = useTranslation();
  const kw = useSettingsKeywords();
  const { config, tempConfig, setTempConfig, saving } = useSettingsConfig();

  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [capabilities, setCapabilities] = useState<EncoderCapability[] | null>(null);
  const [applying, setApplying] = useState(false);
  const appliedRef = useRef<string>("");
  const hotkeysRef = useRef<string>("");

  const clips = tempConfig?.clips;
  const savedClips = config?.clips;

  const patch = useCallback(
    (changes: Partial<ClipConfig>) => {
      if (!tempConfig) return;
      setTempConfig({ ...tempConfig, clips: { ...tempConfig.clips, ...changes } });
    },
    [tempConfig, setTempConfig],
  );

  const onRecordingChange = useCallback(
    (recording: boolean) => {
      if (recording) {
        releaseHotkeys().catch(() => {});
      } else {
        appliedRef.current = "";
        applyClipSettings().catch(() => {});
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const next = await getCaptureStatus();
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    read();
    const timer = setInterval(read, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getEncoderCapabilities()
      .then((next) => {
        if (!cancelled) setCapabilities(next);
      })
      .catch(() => {
        if (!cancelled) setCapabilities([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!savedClips || saving) return;

    const signature = JSON.stringify(savedClips);
    if (appliedRef.current === "") {
      appliedRef.current = signature;
      hotkeysRef.current = hotkeySignature(savedClips);
      return;
    }
    if (appliedRef.current === signature) return;
    appliedRef.current = signature;
    const keysNow = hotkeySignature(savedClips);
    const keysChanged = hotkeysRef.current !== keysNow;
    hotkeysRef.current = keysNow;

    setApplying(true);
    applyClipSettings()
      .then((keys) => {
        if (savedClips.enabled && keysChanged && keys.length > 0) {
          toast.success(t("settings.clips.applied", { keys: keys.join(", ") }));
        }
      })
      .catch((error) => {
        toast.error(t("settings.clips.apply_failed", { error: String(error) }));
      })
      .finally(() => setApplying(false));
  }, [savedClips, saving, t]);

  if (!clips) return null;

  const preset = clips.quality ?? "custom";
  const spec = effectiveSpec(clips);
  const estimatedMb = estimatedBufferMb(clips);
  const clipSeconds = clipLengthSeconds(clips);
  const matrix = capabilities ?? (status?.capabilities.length ? status.capabilities : null);

  const audioAnswered = status?.running === true;
  const gameOnlyUnavailable = audioAnswered && !status.supports_game_only_audio;
  const effectiveAudioSource: AudioSourceChoice =
    clips.audio_source !== "system" && gameOnlyUnavailable ? "system" : clips.audio_source;

  const choosePreset = (next: QualityPreset) => {
    if (next === "custom") {
      patch({ quality: "custom" });
      return;
    }
    const values = QUALITY_PRESETS[next];
    patch({
      quality: next,
      width: values.width,
      height: values.height,
      fps: values.fps,
      bitrate_kbps: values.bitrateKbps,
    });
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        id="settings-section-clips-general"
        title={t("settings.clips.title")}
        icon="solar:videocamera-record-bold"
        keywords={kw("settings.clips.title", "clip", "clips", "replay", "aufnahme", "record", "recording", "highlight")}
        description={t("settings.clips.description")}
      >
        <SettingRow
          label={t("settings.clips.enabled")}
          description={t("settings.clips.enabled.description")}
          searchKeywords={kw("settings.clips.enabled", "clips", "aktivieren", "enable")}
        >
          <ToggleSwitch
            checked={clips.enabled}
            onChange={(enabled) => patch({ enabled })}
            disabled={saving}
          />
        </SettingRow>

        <StatusRow status={status} applying={applying} enabled={clips.enabled} t={t} />
      </SettingsSection>

      <SettingsSection
        id="settings-section-clips-hotkeys"
        title={t("settings.clips.hotkeys.title")}
        icon="solar:keyboard-bold"
        keywords={kw("settings.clips.hotkeys.title", "hotkey", "tastenkombination", "shortcut", "taste", "key")}
        description={t("settings.clips.hotkeys.description")}
      >
        <div className="flex gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3">
          <Icon icon="solar:info-circle-bold" className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <p className="text-sm leading-relaxed text-white/70">
            {t("settings.clips.hotkeys.warning")}
          </p>
        </div>

        <SettingRow
          label={t("settings.clips.hotkeys.save")}
          description={t("settings.clips.hotkeys.save.description")}
          searchKeywords={kw("settings.clips.hotkeys.save", "clip speichern", "save clip")}
          disabled={!clips.enabled}
        >
          <HotkeyInput
            value={clips.hotkey_save}
            onChange={(hotkey_save) => patch({ hotkey_save })}
            conflictsWith={clips.hotkey_toggle}
            onRecordingChange={onRecordingChange}
            disabled={!clips.enabled || saving}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.clips.hotkeys.toggle")}
          description={t("settings.clips.hotkeys.toggle.description")}
          searchKeywords={kw("settings.clips.hotkeys.toggle", "puffer", "buffer", "pause")}
          disabled={!clips.enabled}
        >
          <HotkeyInput
            value={clips.hotkey_toggle}
            onChange={(hotkey_toggle) => patch({ hotkey_toggle })}
            conflictsWith={clips.hotkey_save}
            onRecordingChange={onRecordingChange}
            disabled={!clips.enabled || saving}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="settings-section-clips-buffer"
        title={t("settings.clips.buffer.title")}
        icon="solar:history-bold"
        keywords={kw("settings.clips.buffer.title", "buffer", "puffer", "replay", "laenge", "length", "sekunden")}
        description={t("settings.clips.buffer.description")}
      >
        <SettingRow
          label={t("settings.clips.buffer.length")}
          description={t("settings.clips.buffer.length.description", { mb: estimatedMb })}
          searchKeywords={kw(
            "settings.clips.buffer.length",
            "laenge",
            "length",
            "sekunden",
            "buffer",
            "puffer",
            "speicher",
            "memory",
          )}
          disabled={!clips.enabled}
          vertical
        >
          <RangeSlider
            value={clipSeconds}
            onChange={(pre_roll_seconds) => patch({ pre_roll_seconds })}
            min={MIN_CLIP_SECONDS}
            max={MAX_CLIP_SECONDS}
            step={5}
            valueLabel={`${clipSeconds} s`}
            minLabel={`${MIN_CLIP_SECONDS} s`}
            maxLabel={`${MAX_CLIP_SECONDS} s`}
            disabled={!clips.enabled || saving}
            recommendedValue={30}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="settings-section-clips-quality"
        title={t("settings.clips.quality.title")}
        icon="solar:tuning-bold"
        keywords={kw("settings.clips.quality.title", "qualitaet", "quality", "aufloesung", "resolution", "bitrate", "fps", "encoder")}
        description={t("settings.clips.quality.description")}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {PRESET_ORDER.map((option) => (
            <PresetCard
              key={option}
              preset={option}
              selected={preset === option}
              disabled={!clips.enabled || saving}
              clipSeconds={clipLengthSeconds(clips)}
              onSelect={() => choosePreset(option)}
              t={t}
            />
          ))}
        </div>

        {preset === "custom" && (
          <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2">
            <SettingRow
              label={t("settings.clips.quality.resolution")}
              searchKeywords={kw("settings.clips.quality.resolution", "aufloesung", "resolution", "1080p")}
              disabled={!clips.enabled}
            >
              <div className="w-56">
                <Select
                  value={`${clips.width}x${clips.height}`}
                  onChange={(value) => {
                    const [width, height] = value.split("x").map(Number);
                    patch({ width, height });
                  }}
                  options={CUSTOM_RESOLUTIONS.map((r) => ({
                    value: `${r.width}x${r.height}`,
                    label: `${r.label}  ·  ${r.width} × ${r.height}`,
                  }))}
                  size="sm"
                  variant="flat"
                  disabled={!clips.enabled || saving}
                />
              </div>
            </SettingRow>

            <SettingRow
              label={t("settings.clips.quality.fps")}
              searchKeywords={kw("settings.clips.quality.fps", "bildrate", "framerate", "fps")}
              disabled={!clips.enabled}
            >
              <div className="w-44">
                <Select
                  value={String(clips.fps)}
                  onChange={(value) => patch({ fps: Number(value) })}
                  options={CUSTOM_FPS.map((fps) => ({ value: String(fps), label: `${fps} fps` }))}
                  size="sm"
                  variant="flat"
                  disabled={!clips.enabled || saving}
                />
              </div>
            </SettingRow>

            <SettingRow
              label={t("settings.clips.quality.bitrate")}
              description={t("settings.clips.quality.bitrate.description")}
              searchKeywords={kw("settings.clips.quality.bitrate", "bitrate", "qualitaet", "quality")}
              disabled={!clips.enabled}
            >
              <div className="w-44">
                <Select
                  value={String(clips.bitrate_kbps)}
                  onChange={(value) => patch({ bitrate_kbps: Number(value) })}
                  options={CUSTOM_BITRATES_KBPS.map((kbps) => ({
                    value: String(kbps),
                    label: `${kbps / 1000} Mbps`,
                  }))}
                  size="sm"
                  variant="flat"
                  disabled={!clips.enabled || saving}
                />
              </div>
            </SettingRow>
          </div>
        )}

        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
          <Icon icon="solar:cpu-bold" className="h-5 w-5 shrink-0 text-white/40" />
          <p className="text-sm text-white/60">
            {t("settings.clips.quality.memory", {
              mb: estimatedMb,
              seconds: clipSeconds,
              resolution: resolutionLabel(spec),
              fps: spec.fps,
            })}
          </p>
        </div>

        <BitrateNotice spec={spec} t={t} />

        <FallbackNotice status={status} clips={clips} t={t} />

        <SettingRow
          label={t("settings.clips.quality.codec")}
          description={t("settings.clips.quality.codec.description")}
          searchKeywords={kw("settings.clips.quality.codec", "codec", "h264", "h265", "hevc", "av1")}
          disabled={!clips.enabled}
          vertical
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CODEC_ORDER.map((option) => (
              <CodecCard
                key={option}
                codec={option}
                selected={clips.codec === option}
                capabilities={matrix}
                disabled={!clips.enabled || saving}
                onSelect={() => patch({ codec: option })}
                t={t}
              />
            ))}
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.clips.quality.encoder")}
          description={<EncoderHint status={status} matrix={matrix} codec={clips.codec} t={t} />}
          searchKeywords={kw("settings.clips.quality.encoder", "encoder", "nvenc", "amf", "gpu", "grafikkarte", "cpu", "prozessor")}
          disabled={!clips.enabled}
        >
          <div className="w-64">
            <Select
              value={clips.encoder}
              onChange={(encoder) => patch({ encoder: encoder as ClipEncoder })}
              options={encoderOptions(matrix, clips.codec, t)}
              size="sm"
              variant="flat"
              disabled={!clips.enabled || saving}
            />
          </div>
        </SettingRow>

      </SettingsSection>

      <SettingsSection
        id="settings-section-clips-audio"
        title={t("settings.clips.audio.title")}
        icon="solar:volume-loud-bold"
        keywords={kw("settings.clips.audio.title", "ton", "audio", "sound", "mikrofon", "geraet", "device", "lautsprecher", "headset")}
        description={t("settings.clips.audio.description")}
      >
        <SettingRow
          label={t("settings.clips.quality.audio")}
          description={t("settings.clips.quality.audio.description")}
          searchKeywords={kw("settings.clips.quality.audio", "ton", "audio", "sound")}
          disabled={!clips.enabled}
        >
          <ToggleSwitch
            checked={clips.capture_audio}
            onChange={(capture_audio) => patch({ capture_audio })}
            disabled={!clips.enabled || saving}
          />
        </SettingRow>

        {clips.capture_audio && (
          <>
            <SettingRow
              label={t("settings.clips.audio.source")}
              description={
                gameOnlyUnavailable
                  ? t("settings.clips.audio.source.unsupported")
                  : t("settings.clips.audio.source.description")
              }
              searchKeywords={kw("settings.clips.audio.source", "nur minecraft", "game only", "quelle", "source")}
              disabled={!clips.enabled}
            >
              <div className="w-64">
                <Select
                  value={effectiveAudioSource}
                  onChange={(value) => patch({ audio_source: value as AudioSourceChoice })}
                  options={[
                    { value: "system", label: t("settings.clips.audio.source.system") },
                    ...(["game_only", "both"] as const).map((value) => ({
                      value,
                      label: gameOnlyUnavailable
                        ? `${t(`settings.clips.audio.source.${value}`)} — ${t("settings.clips.audio.source.unavailable_short")}`
                        : t(`settings.clips.audio.source.${value}`),
                    })),
                  ]}
                  size="sm"
                  variant="flat"
                  disabled={!clips.enabled || saving}
                />
              </div>
            </SettingRow>

            {effectiveAudioSource !== "game_only" && (
              <SettingRow
                label={t(
                  effectiveAudioSource === "both"
                    ? "settings.clips.audio.other_volume"
                    : "settings.clips.audio.volume",
                )}
                description={t("settings.clips.audio.volume.description")}
                searchKeywords={kw("settings.clips.audio.volume", "lautstaerke", "volume", "discord", "musik")}
                disabled={!clips.enabled}
                vertical
              >
                <RangeSlider
                  value={clips.other_volume}
                  onChange={(other_volume) => patch({ other_volume })}
                  min={0}
                  max={200}
                  step={5}
                  valueLabel={`${clips.other_volume}%`}
                  minLabel={t("settings.clips.audio.volume.off")}
                  maxLabel="200%"
                  disabled={!clips.enabled || saving}
                  recommendedValue={100}
                />
              </SettingRow>
            )}

            {effectiveAudioSource !== "system" && (
              <SettingRow
                label={t("settings.clips.audio.game_volume")}
                description={
                  effectiveAudioSource === "both"
                    ? undefined
                    : t("settings.clips.audio.volume.description")
                }
                searchKeywords={kw("settings.clips.audio.game_volume", "lautstaerke", "volume", "spiel", "minecraft")}
                disabled={!clips.enabled}
                vertical
              >
                <RangeSlider
                  value={clips.game_volume}
                  onChange={(game_volume) => patch({ game_volume })}
                  min={0}
                  max={200}
                  step={5}
                  valueLabel={`${clips.game_volume}%`}
                  minLabel={t("settings.clips.audio.volume.off")}
                  maxLabel="200%"
                  disabled={!clips.enabled || saving}
                  recommendedValue={100}
                />
              </SettingRow>
            )}

            {effectiveAudioSource === "system" && (
              <SettingRow
                label={t("settings.clips.audio.device")}
                description={t("settings.clips.audio.device.description")}
                searchKeywords={kw("settings.clips.audio.device", "geraet", "device", "lautsprecher", "headset", "kopfhoerer")}
                disabled={!clips.enabled}
              >
                <div className="w-72">
                  <Select
                    value={clips.audio_device_id ?? DEFAULT_DEVICE}
                    onChange={(value) =>
                      patch({ audio_device_id: value === DEFAULT_DEVICE ? null : value })
                    }
                    options={audioDeviceOptions(
                      status?.audio_devices ?? [],
                      clips.audio_device_id,
                      t,
                    )}
                    size="sm"
                    variant="flat"
                    disabled={!clips.enabled || saving}
                  />
                </div>
              </SettingRow>
            )}
            <SettingRow
              label={t("settings.clips.audio.microphone")}
              description={t("settings.clips.audio.microphone.description")}
              searchKeywords={kw("settings.clips.audio.microphone", "mikrofon", "microphone", "stimme", "voice", "mic")}
              disabled={!clips.enabled}
            >
              <ToggleSwitch
                checked={clips.capture_microphone}
                onChange={(capture_microphone) => patch({ capture_microphone })}
                disabled={!clips.enabled || saving}
              />
            </SettingRow>

            {clips.capture_microphone && (
              <>
                <SettingRow
                  label={t("settings.clips.audio.microphone.device")}
                  searchKeywords={kw("settings.clips.audio.microphone.device", "mikrofon", "microphone", "geraet")}
                  disabled={!clips.enabled}
                >
                  <div className="w-72">
                    <Select
                      value={clips.microphone_device_id ?? DEFAULT_DEVICE}
                      onChange={(value) =>
                        patch({
                          microphone_device_id: value === DEFAULT_DEVICE ? null : value,
                        })
                      }
                      options={audioDeviceOptions(
                        status?.microphones ?? [],
                        clips.microphone_device_id,
                        t,
                      )}
                      size="sm"
                      variant="flat"
                      disabled={!clips.enabled || saving}
                    />
                  </div>
                </SettingRow>

                <SettingRow
                  label={t("settings.clips.audio.microphone_volume")}
                  searchKeywords={kw("settings.clips.audio.microphone_volume", "mikrofon", "lautstaerke", "volume")}
                  disabled={!clips.enabled}
                  vertical
                >
                  <RangeSlider
                    value={clips.microphone_volume}
                    onChange={(microphone_volume) => patch({ microphone_volume })}
                    min={0}
                    max={200}
                    step={5}
                    valueLabel={`${clips.microphone_volume}%`}
                    minLabel={t("settings.clips.audio.volume.off")}
                    maxLabel="200%"
                    disabled={!clips.enabled || saving}
                    recommendedValue={100}
                  />
                </SettingRow>
              </>
            )}
          </>
        )}
      </SettingsSection>

      <SettingsSection
        id="settings-section-clips-storage"
        title={t("settings.clips.storage.title")}
        icon="solar:folder-bold"
        keywords={kw("settings.clips.storage.title", "ordner", "folder", "speicherort", "storage", "path")}
        description={t("settings.clips.storage.description")}
      >
        <SettingRow
          label={t("settings.clips.storage.folder")}
          description={clips.output_dir ?? t("settings.clips.storage.default")}
          searchKeywords={kw("settings.clips.storage.folder", "ordner", "folder", "oeffnen", "open")}
        >
          <button
            type="button"
            onClick={() => void openClipFolder().catch(() => {})}
            className={cn(
              "flex items-center gap-2 rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5",
              "text-sm text-white/80 transition-colors",
              "hover:border-white/25 hover:bg-white/[0.08] hover:text-white",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
            )}
          >
            <Icon icon="solar:folder-with-files-linear" className="h-4 w-4 shrink-0" />
            {t("settings.clips.storage.open")}
          </button>
        </SettingRow>

        <SettingRow
          label={t("settings.clips.storage.limit")}
          description={
            clips.max_storage_gb === 0
              ? t("settings.clips.storage.limit_off")
              : `${t("settings.clips.storage.limit_description", { gb: clips.max_storage_gb })} ${t("settings.clips.storage.limit_hint")}`
          }
          searchKeywords={kw(
            "settings.clips.storage.limit",
            "speicher",
            "storage",
            "limit",
            "gb",
            "platz",
            "voll",
          )}
        >
          <StorageLimitInput
            value={clips.max_storage_gb}
            onCommit={(value) => patch({ max_storage_gb: value })}
            t={t}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="settings-section-clips-library"
        title={t("settings.clips.library.title")}
        icon="solar:video-library-bold"
        keywords={kw(
          "settings.clips.library.title",
          "clips",
          "galerie",
          "gallery",
          "aufnahmen",
          "videos",
          "ansehen",
          "loeschen",
        )}
        description={t("settings.clips.library.description")}
      >
        <ClipGallery />
      </SettingsSection>
    </div>
  );
}

function StatusRow({
  status,
  applying,
  enabled,
  t,
}: {
  status: CaptureStatus | null;
  applying: boolean;
  enabled: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (!enabled) return null;

  const { tone, icon, text } = describeStatus(status, applying, t);

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        tone === "good" && "border-emerald-400/25 bg-emerald-400/[0.07]",
        tone === "warn" && "border-amber-400/25 bg-amber-400/[0.07]",
        tone === "bad" && "border-red-400/25 bg-red-400/[0.07]",
        tone === "idle" && "border-white/10 bg-white/[0.03]",
      )}
    >
      <Icon
        icon={icon}
        className={cn(
          "mt-0.5 h-5 w-5 shrink-0",
          tone === "good" && "text-emerald-300",
          tone === "warn" && "text-amber-300",
          tone === "bad" && "text-red-300",
          tone === "idle" && "text-white/40",
        )}
      />
      <div className="min-w-0">
        <p className="text-sm text-white/80">{text}</p>
        {status?.adapter && status.adapter !== "<not attached>" && (
          <p className="mt-0.5 text-xs text-white/40">{status.adapter}</p>
        )}
      </div>
    </div>
  );
}

function describeStatus(
  status: CaptureStatus | null,
  applying: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): { tone: "good" | "warn" | "bad" | "idle"; icon: string; text: string } {
  if (applying) {
    return { tone: "idle", icon: "svg-spinners:ring-resize", text: t("settings.clips.status.applying") };
  }
  if (!status || !status.running) {
    return { tone: "idle", icon: "solar:moon-sleep-bold", text: t("settings.clips.status.stopped") };
  }

  switch (status.state) {
    case "buffering":
      return { tone: "good", icon: "solar:record-circle-bold", text: t("settings.clips.status.recording") };
    case "attaching":
      return { tone: "idle", icon: "svg-spinners:ring-resize", text: t("settings.clips.status.waiting") };
    case "paused":
      return { tone: "warn", icon: "solar:pause-circle-bold", text: t("settings.clips.status.paused") };
    // The one failure users can fix themselves, so it gets its own message.
    case "blocked_fullscreen_exclusive":
      return { tone: "warn", icon: "solar:danger-triangle-bold", text: t("settings.clips.status.fullscreen") };
    case "failed":
      return { tone: "bad", icon: "solar:close-circle-bold", text: t("settings.clips.status.failed") };
    default:
      return { tone: "idle", icon: "solar:moon-sleep-bold", text: t("settings.clips.status.idle") };
  }
}

function FallbackNotice({
  status,
  clips,
  t,
}: {
  status: CaptureStatus | null;
  clips: ClipConfig;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const codec = status?.active_codec ?? null;
  const encoder = status?.active_encoder ?? null;
  if (!codec || codec === clips.codec) return null;

  return (
    <div className="flex gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3">
      <Icon icon="solar:info-circle-bold" className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
      <p className="text-sm leading-relaxed text-white/70">
        {t("settings.clips.quality.codec.fallback", {
          requested: t(`settings.clips.quality.codec.${clips.codec}`),
          actual: t(`settings.clips.quality.codec.${codec}`),
          encoder:
            encoder === "software"
              ? t("settings.clips.quality.encoder.cpu")
              : t("settings.clips.quality.encoder.gpu"),
        })}
      </p>
    </div>
  );
}

function PresetCard({
  preset,
  selected,
  disabled,
  clipSeconds,
  onSelect,
  t,
}: {
  preset: QualityPreset;
  selected: boolean;
  disabled: boolean;
  clipSeconds: number;
  onSelect: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const values = preset === "custom" ? null : QUALITY_PRESETS[preset];

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40",
        selected
          ? "border-emerald-400/40 bg-emerald-400/[0.08]"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
        disabled && "cursor-not-allowed opacity-40 hover:border-white/10 hover:bg-white/[0.03]",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-white/90">
          {t(`settings.clips.quality.preset.${preset}`)}
        </span>
        {selected && (
          <Icon icon="solar:check-circle-bold" className="h-4 w-4 shrink-0 text-emerald-300" />
        )}
      </span>

      <span className="text-xs leading-snug text-white/50">
        {t(`settings.clips.quality.preset.${preset}.description`)}
      </span>

      {values ? (
        <>
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            <Chip>{resolutionLabel({ ...values, bitrateKbps: values.bitrateKbps })}</Chip>
            <Chip>{values.fps} fps</Chip>
            <Chip>{values.bitrateKbps / 1000} Mbps</Chip>
          </span>

          <span className="mt-1 text-[11px] tabular-nums text-white/40">
            {t("settings.clips.quality.preset.size_estimate", {
              mb: estimatedClipMb(values.bitrateKbps, clipSeconds),
              seconds: clipSeconds,
            })}
          </span>
        </>
      ) : (
        <span className="mt-1.5 text-xs text-white/45">
          {t("settings.clips.quality.preset.custom.hint")}
        </span>
      )}
    </button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[11px] tabular-nums text-white/75">
      {children}
    </span>
  );
}

function estimatedClipMb(bitrateKbps: number, seconds: number): number {
  const withAudio = bitrateKbps + AUDIO_KBPS;
  return Math.round((withAudio * seconds) / 8 / 1000);
}

function CodecCard({
  codec,
  selected,
  capabilities,
  disabled,
  onSelect,
  t,
}: {
  codec: ClipCodec;
  selected: boolean;
  capabilities: EncoderCapability[] | null;
  disabled: boolean;
  onSelect: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const usable = usableFor(capabilities, codec);
  const unavailable = capabilities !== null && usable.length === 0;
  const hardware = usable.some((c) => c.hardware);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || unavailable}
      aria-pressed={selected}
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40",
        selected && !unavailable
          ? "border-emerald-400/40 bg-emerald-400/[0.08]"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
        (disabled || unavailable) &&
          "cursor-not-allowed opacity-40 hover:border-white/10 hover:bg-white/[0.03]",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium text-white/90">
          {t(`settings.clips.quality.codec.${codec}`)}
        </span>
        {!unavailable && hardware && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/50">
            {t("settings.clips.quality.encoder.gpu")}
          </span>
        )}
      </span>
      <span className="text-xs leading-snug text-white/50">
        {unavailable
          ? t("settings.clips.quality.codec.unavailable")
          : t(`settings.clips.quality.codec.${codec}.note`)}
      </span>
    </button>
  );
}

function audioDeviceOptions(
  devices: AudioDeviceInfo[],
  selected: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): { value: string; label: string }[] {
  const options = [
    { value: DEFAULT_DEVICE, label: t("settings.clips.audio.device.default") },
    ...devices.map((device) => ({
      value: device.id,
      label: device.is_default
        ? `${device.name} — ${t("settings.clips.audio.device.is_default")}`
        : device.name,
    })),
  ];

  if (selected && !devices.some((device) => device.id === selected)) {
    options.push({
      value: selected,
      label: t("settings.clips.audio.device.missing"),
    });
  }

  return options;
}

function usableFor(
  capabilities: EncoderCapability[] | null,
  codec: ClipCodec,
): EncoderCapability[] {
  return (capabilities ?? []).filter((c) => c.codec === codec && c.available);
}

function encoderOptions(
  capabilities: EncoderCapability[] | null,
  codec: ClipCodec,
  t: (key: string) => string,
): { value: string; label: string }[] {
  const names: Record<string, string> = {
    auto: t("settings.clips.quality.encoder.auto"),
    nvenc: "NVIDIA NVENC",
    amf: "AMD AMF",
    quick_sync: "Intel Quick Sync",
    software: t("settings.clips.quality.encoder.software"),
  };

  if (capabilities === null) {
    return Object.keys(names).map((value) => ({ value, label: names[value] }));
  }

  const usable = usableFor(capabilities, codec);
  return [
    { value: "auto", label: names.auto },
    ...usable.map((c) => ({
      value: c.encoder,
      label: `${names[c.encoder] ?? c.encoder}  ·  ${t(
        c.hardware ? "settings.clips.quality.encoder.gpu" : "settings.clips.quality.encoder.cpu",
      )}`,
    })),
  ];
}

function EncoderHint({
  status,
  matrix,
  codec,
  t,
}: {
  status: CaptureStatus | null;
  matrix: EncoderCapability[] | null;
  codec: ClipCodec;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (matrix === null) {
    return <>{t("settings.clips.quality.encoder.probing")}</>;
  }

  const usable = usableFor(matrix, codec);
  if (usable.length === 0) {
    return <>{t("settings.clips.quality.encoder.none")}</>;
  }
  if (!usable.some((c) => c.hardware)) {
    return <>{t("settings.clips.quality.encoder.cpu_only")}</>;
  }

  const adapter = status?.adapter?.trim();

  return (
    <>
      {adapter
        ? t("settings.clips.quality.encoder.detected", {
            count: usable.length,
            adapter,
          })
        : t("settings.clips.quality.encoder.detected_no_adapter", {
            count: usable.length,
          })}
    </>
  );
}

function StorageLimitInput({
  value,
  onCommit,
  t,
}: {
  value: number;
  onCommit: (value: number) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(parsed, 10_000);
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={10_000}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className={cn(
          "w-20 rounded-md border border-white/15 bg-white/[0.04] px-2.5 py-1.5",
          "text-right text-sm tabular-nums text-white/90",
          "focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
        aria-label={t("settings.clips.storage.limit")}
      />
      <span className="text-sm text-white/45">
        {t("settings.clips.storage.limit_unit")}
      </span>
    </div>
  );
}

function bitsPerPixel(spec: QualitySpec): number {
  const pixels = spec.width * spec.height * spec.fps;
  return pixels > 0 ? (spec.bitrateKbps * 1000) / pixels : 0;
}

function BitrateNotice({
  spec,
  t,
}: {
  spec: QualitySpec;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const bpp = bitsPerPixel(spec);
  if (bpp >= 0.05) return null;

  const suggested =
    Math.ceil((spec.width * spec.height * spec.fps * 0.09) / 1000 / 1000) * 1000;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3">
      <Icon icon="solar:info-circle-bold" className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
      <div className="min-w-0">
        <p className="text-sm text-white/80">
          {t("settings.clips.quality.thin_bitrate", {
            fps: spec.fps,
            mbps: spec.bitrateKbps / 1000,
          })}
        </p>
        <p className="mt-0.5 text-xs text-white/50">
          {t("settings.clips.quality.thin_bitrate.hint", {
            suggested: Math.round(suggested / 1000),
          })}
        </p>
      </div>
    </div>
  );
}
