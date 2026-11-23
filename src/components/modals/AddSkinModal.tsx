import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinecraftSkin, SkinVariant } from "../../types/localSkin";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { open } from "@tauri-apps/plugin-dialog";
import { MinecraftSkinService } from "../../services/minecraft-skin-service";
import { SkinRenderer } from "@noriskclient/nrc-skin-renderer/react";
import { WebGLBoundary } from "../WebGLBoundary";
import { FlatSkin } from "@noriskclient/nrc-skin-renderer/react";
import { useIdleEmote } from "../../hooks/useIdleEmote";
import { SearchStyleInput } from "../ui/Input";
import { FieldLabel, SegmentedControl } from "../ui/SegmentedControl";
import { parseErrorMessage } from "../../utils/error-utils";

interface AddSkinModalProps {
  skin?: MinecraftSkin;
  onSave: (skin: MinecraftSkin) => Promise<void>;
  onSaveAndApply?: (skin: MinecraftSkin) => Promise<void>;
  onAdd: (
    skinInput: string,
    targetName: string,
    targetVariant: SkinVariant,
    description?: string | null,
  ) => Promise<void>;
  isLoading: boolean;
}

const DEFAULT_SKIN = "/skins/steve.png";

export const AddSkinModal = memo(
  ({ skin, onSave, onSaveAndApply, onAdd, isLoading }: AddSkinModalProps) => {
    const { t } = useTranslation();
    const [isSlimVariant, setIsSlimVariant] = useState<boolean>(
      skin?.variant === "slim",
    );

    // Initialize states for existing skin editing
    const [skinInput, setSkinInput] = useState<string>(skin ? skin.name : "");
    const [isPreviewMode, setIsPreviewMode] = useState<boolean>(!!skin); // Auto-preview for existing skins
    const [previewBase64Url, setPreviewBase64Url] = useState<string | null>(
      skin ? `data:image/png;base64,${skin.base64_data}` : null
    );
    const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
    const [previewSkinName, setPreviewSkinName] = useState<string>(skin?.name ?? "");

    const variant: SkinVariant = isSlimVariant ? "slim" : "classic";
    const { hideModal } = useGlobalModal();
    const idleEmote = useIdleEmote();

    const handleClose = () => {
      hideModal('add-skin-modal');
      // Reset states when closing
      setIsPreviewMode(!!skin);
      setPreviewBase64Url(skin ? `data:image/png;base64,${skin.base64_data}` : null);
      setPreviewSkinName(skin?.name ?? "");
      setIsSlimVariant(skin?.variant === "slim");
    };

    const handlePreview = async (source: string = skinInput) => {
      const trimmedInput = source.trim();
      if (!trimmedInput) {
        toast.error(t('skins.skinSourceEmpty'));
        return;
      }

      setIsPreviewLoading(true);

      try {

        // Create SkinSourceDetails based on input type (similar to addSkinLocally logic)
        let sourceDetails: any;

        // Regex patterns (should match the ones in minecraft-skin-service.ts)
        const MINECRAFT_USERNAME_REGEX = /^[a-zA-Z0-9_]{2,16}$/;
        const UUID_REGEX = /^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

        if (MINECRAFT_USERNAME_REGEX.test(trimmedInput)) {
          sourceDetails = { type: "Profile", details: { query: trimmedInput } };
        } else if (UUID_REGEX.test(trimmedInput)) {
          sourceDetails = { type: "Profile", details: { query: trimmedInput } };
        } else {
          let isHttpUrl = false;
          let isFileProtocolUrl = false;
          let pathFromUrlIfFileProtocol = "";

          try {
            const parsedUrl = new URL(trimmedInput);
            if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
              isHttpUrl = true;
            } else if (parsedUrl.protocol === "file:") {
              isFileProtocolUrl = true;
              let rawPath = decodeURIComponent(parsedUrl.pathname);
              // Normalize path: remove leading slash on Windows if it looks like /C:/path
              if (rawPath.length > 2 && rawPath.startsWith('/') && rawPath[2] === ':') {
                rawPath = rawPath.substring(1);
              }
              pathFromUrlIfFileProtocol = rawPath;
            }
          } catch (e) {
            // Not a parsable URL, will be treated as FilePath
          }

          if (isHttpUrl) {
            sourceDetails = { type: "Url", details: { url: trimmedInput } };
          } else if (isFileProtocolUrl) {
            sourceDetails = { type: "FilePath", details: { path: pathFromUrlIfFileProtocol } };
          } else {
            // Assume it's a direct file path
            sourceDetails = { type: "FilePath", details: { path: trimmedInput } };
          }
        }

        // Get base64 data from the source
        const base64Data = await MinecraftSkinService.getBase64FromSkinSource(sourceDetails);

        // Generate target name for the preview (same logic as in handleSave)
        let targetName = "";
        const looksLikeHttpUrl = /^(https?):\/\//i.test(trimmedInput);
        const isLikelyFilePath = (input: string): boolean => {
          if (input.startsWith("file://")) return true;
          const hasPathSeparators = /[\\/]/.test(input);
          const isHttp = /^(https?):\/\//i.test(input);
          return hasPathSeparators && !isHttp;
        };

        if (looksLikeHttpUrl) {
          try {
            const url = new URL(trimmedInput);
            const pathnameParts = url.pathname
              .split("/")
              .filter((part) => part.length > 0);
            targetName = pathnameParts.pop() || url.hostname || "Web_Skin";
            if (targetName.match(/\.(png|jpg|jpeg|gif)$/i)) {
              targetName = targetName.substring(0, targetName.lastIndexOf("."));
            }
          } catch (e) {
            targetName = "Invalid_Web_Skin_Url";
            console.error("Error parsing HTTP URL for name:", e);
          }
        } else if (isLikelyFilePath(trimmedInput)) {
          let pathForNameExtraction = trimmedInput;
          if (trimmedInput.startsWith("file://")) {
            try {
              const tempUrl = new URL(trimmedInput);
              pathForNameExtraction = decodeURIComponent(tempUrl.pathname);
            } catch (e) {
              console.error(
                "Error parsing file:// URL for name extraction:",
                e,
              );
            }
          }
          const pathParts = pathForNameExtraction.split(/[\\/]/);
          targetName = pathParts.pop() || "File_Skin";
          if (targetName.match(/\.(png|jpg|jpeg|gif)$/i)) {
            targetName = targetName.substring(0, targetName.lastIndexOf("."));
          }
        } else {
          targetName = trimmedInput;
        }

        if (!targetName.trim()) {
          targetName = "Unnamed_Skin";
          console.warn(
            "Derived target name was empty, falling back to Unnamed_Skin for input:",
            trimmedInput,
          );
        }

        // Create data URL for the skin viewer
        const base64Url = `data:image/png;base64,${base64Data}`;

        setPreviewBase64Url(base64Url);
        setPreviewSkinName(targetName);
        setIsPreviewMode(true);

      } catch (error) {
        console.error("Error loading skin preview:", error);
        console.error("Error details:", {
          message: parseErrorMessage(error),
          stack: error instanceof Error ? error.stack : undefined,
          input: trimmedInput
        });
        toast.error(t('skins.failedToLoadPreview', { error: parseErrorMessage(error) }));
      } finally {
        setIsPreviewLoading(false);
      }
    };

    const handleOpenFileUpload = async () => {
      try {
        const selectedFile = await open({
          multiple: false,
          directory: false,
          filters: [
            {
              name: t('skins.skinImage'),
              extensions: ["png"],
            },
          ],
          title: t('skins.selectSkinFile'),
        });

        if (typeof selectedFile === "string") {
          setSkinInput(selectedFile);
          await handlePreview(selectedFile);
        }
      } catch (error) {
        console.error("Error opening file dialog:", error);
        toast.error(t('skins.failedToOpenFileDialog'));
      }
    };

    const handleSave = async () => {
      const saveOperation = async () => {
        if (skin) {
          return await onSave({
            ...skin,
            name: previewSkinName || skin.name,
            variant,
          });
        } else {
          const trimmedInput = skinInput.trim();
          if (!trimmedInput) {
            throw new Error(t('skins.skinSourceEmpty'));
          }

          // Use the same name generation logic as in the original code
          let targetName = "";
          const looksLikeHttpUrl = /^(https?):\/\//i.test(trimmedInput);
          const isLikelyFilePath = (input: string): boolean => {
            if (input.startsWith("file://")) return true;
            const hasPathSeparators = /[\\/]/.test(input);
            const isHttp = /^(https?):\/\//i.test(input);
            return hasPathSeparators && !isHttp;
          };

          if (looksLikeHttpUrl) {
            try {
              const url = new URL(trimmedInput);
              const pathnameParts = url.pathname
                .split("/")
                .filter((part) => part.length > 0);
              targetName = pathnameParts.pop() || url.hostname || "Web_Skin";
              if (targetName.match(/\.(png|jpg|jpeg|gif)$/i)) {
                targetName = targetName.substring(0, targetName.lastIndexOf("."));
              }
            } catch (e) {
              targetName = "Invalid_Web_Skin_Url";
              console.error("Error parsing HTTP URL for name:", e);
            }
          } else if (isLikelyFilePath(trimmedInput)) {
            let pathForNameExtraction = trimmedInput;
            if (trimmedInput.startsWith("file://")) {
              try {
                const tempUrl = new URL(trimmedInput);
                pathForNameExtraction = decodeURIComponent(tempUrl.pathname);
              } catch (e) {
                console.error(
                  "Error parsing file:// URL for name extraction:",
                  e,
                );
              }
            }
            const pathParts = pathForNameExtraction.split(/[\\/]/);
            targetName = pathParts.pop() || "File_Skin";
            if (targetName.match(/\.(png|jpg|jpeg|gif)$/i)) {
              targetName = targetName.substring(0, targetName.lastIndexOf("."));
            }
          } else {
            targetName = trimmedInput;
          }

          // Use previewSkinName if available (when in preview mode)
          if (previewSkinName.trim()) {
            targetName = previewSkinName.trim();
          }

          if (!targetName.trim()) {
            targetName = "Unnamed_Skin";
            console.warn(
              "Derived target name was empty, falling back to Unnamed_Skin for input:",
              trimmedInput,
            );
          }

        return await onAdd(trimmedInput, targetName, variant, null);
        }
      };

      // Use Promise Toast for better UX
      toast.promise(saveOperation(), {
        loading: skin ? t('skins.updatingSkin') : t('skins.addingSkin'),
        success: (result) => {
          const skinName = skin ? (previewSkinName || skin.name) : previewSkinName;
          return skin ? t('skins.skinUpdatedSuccess', { name: skinName }) : t('skins.skinAddedSuccess', { name: skinName });
        },
        error: (err) => {
          console.error("Save error:", err);
          return err instanceof Error ? err.message : t('skins.failedToSaveSkin');
        },
      });
    };

    const handleSaveAndApply = async () => {
      if (!skin || !onSaveAndApply) return;
      const updated = {
        ...skin,
        name: previewSkinName || skin.name,
        variant,
      };

      void onSaveAndApply(updated);
      handleClose();
    };

    const hasPreview = !!previewBase64Url && isPreviewMode;

    const busy = isLoading || isPreviewLoading;

    return (
      <Modal
        title={skin ? t('skins.editSkinProperties') : t('skins.addSkin')}
        onClose={handleClose}
        variant="flat"
        width="lg"
        footer={
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={handleClose} disabled={busy} size="sm">
              {t('common.cancel')}
            </Button>
            {skin && onSaveAndApply && (
              <Button variant="flat-secondary" onClick={handleSaveAndApply} disabled={busy} size="sm">
                {t('skins.saveAndApply')}
              </Button>
            )}
            <Button variant="flat" onClick={handleSave} disabled={busy || !hasPreview} size="sm">
              {isLoading ? t('skins.saving') : skin ? t('skins.saveChanges') : t('skins.saveSkin')}
            </Button>
          </div>
        }
      >
        <div className="p-6 flex gap-7">
          <div className="relative w-64 min-h-[22rem] self-stretch shrink-0 rounded-lg overflow-hidden bg-black/30 border border-white/10">
            <WebGLBoundary
              label="add-skin preview"
              fallback={<FlatSkin textureUrl={hasPreview ? previewBase64Url : DEFAULT_SKIN} variant={variant} />}
            >
              <SkinRenderer
                textureUrl={hasPreview ? previewBase64Url : DEFAULT_SKIN}
                variant={hasPreview ? variant : "classic"}
                emote={idleEmote.urls}
                emoteLoop={idleEmote.loop}
                zoom={1.75}
                draggable
                dragAxis="yaw"
                fps={30}
                style={{ width: "100%", height: "100%", opacity: hasPreview ? 1 : 0.35 }}
              />
            </WebGLBoundary>
            {!hasPreview && (
              <p className="absolute inset-x-0 bottom-3 text-center font-minecraft text-xs text-white/50">
                {t('skins.previewPlaceholder')}
              </p>
            )}
            {isPreviewLoading && (
              <Icon icon="svg-spinners:ring-resize" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-white/70" />
            )}
          </div>

          <div className="flex-1 min-w-0 min-h-[22rem] flex flex-col">
            {!hasPreview ? (
              <div className="flex-1 flex flex-col gap-3">
                <FieldLabel htmlFor="skinInputField">{t('skins.skin')}</FieldLabel>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 min-w-0">
                    <SearchStyleInput
                      id="skinInputField"
                      icon="solar:link-bold"
                      className="text-sm"
                      value={skinInput}
                      onChange={(e) => setSkinInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handlePreview();
                      }}
                      placeholder={t('skins.sourcePlaceholder')}
                      disabled={busy}
                    />
                  </div>
                  <Button
                    variant="flat-secondary"
                    size="sm"
                    heightClassName="h-auto"
                    onClick={() => void handlePreview()}
                    disabled={busy || !skinInput.trim()}
                  >
                    {isPreviewLoading ? t('skins.loading') : t('skins.load')}
                  </Button>
                </div>
                <div className="flex items-center gap-3 text-white/30 font-minecraft text-xs uppercase tracking-wider">
                  <span className="h-px flex-1 bg-white/10" />
                  {t('skins.or')}
                  <span className="h-px flex-1 bg-white/10" />
                </div>
                <button
                  type="button"
                  onClick={() => void handleOpenFileUpload()}
                  disabled={busy}
                  className="group flex-1 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-white/15 hover:border-white/35 bg-black/20 hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  <span className="w-12 h-12 rounded-full bg-white/5 group-hover:bg-white/10 flex items-center justify-center transition-colors">
                    <Icon icon="solar:upload-bold" className="w-5 h-5 text-white/60 group-hover:text-white" />
                  </span>
                  <span className="flex flex-col items-center gap-1">
                    <span className="font-minecraft text-sm text-white/75 group-hover:text-white">{t('skins.uploadSkinFromFile')}</span>
                    <span className="font-minecraft text-xs text-white/35">{t('skins.fileHint')}</span>
                  </span>
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-6">
              <label className="group flex items-center gap-3 pb-2 border-b-2 border-white/10 focus-within:border-white/40 transition-colors cursor-text">
                <input
                  value={previewSkinName}
                  onChange={(e) => setPreviewSkinName(e.target.value)}
                  placeholder={t('skins.enterSkinName')}
                  disabled={isLoading}
                  aria-label={t('skins.skinName')}
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 min-w-0 bg-transparent outline-none font-minecraft text-3xl text-white placeholder-white/25 normal-case"
                />
                <Icon icon="solar:pen-bold" className="w-5 h-5 shrink-0 text-white/30 group-hover:text-white/60 group-focus-within:text-white/80 transition-colors" />
              </label>

              <div className="flex flex-col gap-2">
                <FieldLabel>{t('skins.skinVariant')}</FieldLabel>
                <SegmentedControl
                  stretch
                  value={variant}
                  onChange={(next) => setIsSlimVariant(next === "slim")}
                  disabled={isLoading}
                  options={[
                    { value: "classic", label: t('skins.classicSteve') },
                    { value: "slim", label: t('skins.slimAlex') },
                  ]}
                />
              </div>

                {!skin && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsPreviewMode(false);
                      setPreviewBase64Url(null);
                    }}
                    disabled={busy}
                    className="mt-auto self-start flex items-center gap-2 font-minecraft text-sm text-white/50 hover:text-white transition-colors"
                  >
                    <Icon icon="solar:refresh-bold" className="w-4 h-4" />
                    {t('skins.chooseOther')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>
    );
  },
);
