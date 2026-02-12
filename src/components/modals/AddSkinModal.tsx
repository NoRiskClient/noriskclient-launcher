"use client";

import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinecraftSkin, SkinVariant } from "../../types/localSkin";
import { useThemeStore } from "../../store/useThemeStore";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { Icon } from "@iconify/react";
import { Input } from "../ui/Input";
import { Checkbox } from "../ui/Checkbox";
import { toast } from "react-hot-toast";
import { open } from "@tauri-apps/plugin-dialog";
import { MinecraftSkinService } from "../../services/minecraft-skin-service";
import { SkinView3DWrapper } from "../common/SkinView3DWrapper";
import { SearchStyleInput } from "../ui/Input";

interface AddSkinModalProps {
  skin?: MinecraftSkin;
  onSave: (skin: MinecraftSkin) => Promise<void>;
  onAdd: (
    skinInput: string,
    targetName: string,
    targetVariant: SkinVariant,
    description?: string | null,
  ) => Promise<void>;
  isLoading: boolean;
}

export const AddSkinModal = memo(
  ({ skin, onSave, onAdd, isLoading }: AddSkinModalProps) => {
    const { t } = useTranslation();
    const [name, setName] = useState<string>(skin?.name ?? "");
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
    const accentColor = useThemeStore((state) => state.accentColor);
    const { hideModal } = useGlobalModal();

    const handleClose = () => {
      hideModal('add-skin-modal');
      // Reset states when closing
      setIsPreviewMode(!!skin);
      setPreviewBase64Url(skin ? `data:image/png;base64,${skin.base64_data}` : null);
      setPreviewSkinName(skin?.name ?? "");
      setIsSlimVariant(skin?.variant === "slim");
    };

    const handlePreview = async () => {
      const trimmedInput = skinInput.trim();
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
        toast.success(t('skins.previewLoadedSuccess'));

      } catch (error) {
        console.error("Error loading skin preview:", error);
        console.error("Error details:", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          input: trimmedInput
        });
        toast.error(t('skins.failedToLoadPreview', { error: error instanceof Error ? error.message : String(error) }));
      } finally {
        setIsPreviewLoading(false);
      }
    };

    const handleBackToEdit = () => {
      setIsPreviewMode(false);
      setPreviewBase64Url(null);
      setIsPreviewLoading(false);
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
          toast.success(t('skins.fileSelected', { name: selectedFile.split(/[\\/]/).pop() }));
        } else if (selectedFile === null) {
          console.log("User cancelled file selection.");
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

    return (
      <Modal
        title={skin ? t('skins.editSkinProperties') : (isPreviewMode ? t('skins.addSkinPreview') : t('skins.addSkin'))}
        onClose={handleClose}
        variant="flat"
        footer={
          <div className="flex gap-3 justify-center">
            {isPreviewMode ? (
              <Button
                variant="flat"
                onClick={handleSave}
                disabled={isLoading}
                size="sm"
              >
                {isLoading ? t('skins.saving') : (skin ? t('skins.saveChanges') : t('skins.saveSkin'))}
              </Button>
            ) : (
              <>
                {!skin && (
                  <Button
                    variant="flat-secondary"
                    onClick={handlePreview}
                    disabled={isPreviewLoading}
                    size="sm"
                  >
                    {isPreviewLoading ? t('skins.loading') : t('skins.previewSkin')}
                  </Button>
                )}
                {skin && (
                  <Button
                    variant="flat"
                    onClick={handleSave}
                    disabled={isLoading}
                    size="sm"
                  >
                    {isLoading ? t('skins.saving') : t('skins.saveChanges')}
                  </Button>
                )}
                <Button
                  variant="flat-secondary"
                  onClick={handleClose}
                  disabled={isLoading || isPreviewLoading}
                  size="sm"
                >
                  {t('common.cancel')}
                </Button>
              </>
            )}
          </div>
        }
      >
        {isPreviewMode ? (
          <div className="p-4">
            {/* Skin Name Input - Above Preview */}
            <div className="flex justify-center mb-4">
              <div className="w-full max-w-md">
                <SearchStyleInput
                  value={previewSkinName}
                  onChange={(e) => setPreviewSkinName(e.target.value)}
                  placeholder={t('skins.enterSkinName')}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="flex justify-center">
              <div className="w-64 h-80">
                <SkinView3DWrapper
                  skinUrl={previewBase64Url || undefined}
                  skinVariant={variant}
                  enableAutoRotate={true}
                  autoRotateSpeed={0.2}
                  zoom={0.9}
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="flex justify-center gap-6">
                <Checkbox
                  checked={!isSlimVariant}
                  onChange={(e) => setIsSlimVariant(false)}
                  disabled={isLoading}
                  label={t('skins.classicSteve')}
                  size="md"
                />
                <Checkbox
                  checked={isSlimVariant}
                  onChange={(e) => setIsSlimVariant(true)}
                  disabled={isLoading}
                  label={t('skins.slimAlex')}
                  size="md"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {skin && (
              <div className="space-y-4">
                {/* 3D Skin Preview for editing */}
                <div className="flex justify-center">
                  <div className="w-48 h-64">
                    <SkinView3DWrapper
                      skinUrl={previewBase64Url || undefined}
                      skinVariant={variant}
                      enableAutoRotate={true}
                      autoRotateSpeed={0.3}
                      zoom={0.8}
                    />
                  </div>
                </div>

                {/* Skin Name Input */}
                <div>
                  <label className="block font-minecraft text-3xl text-white/80 lowercase mb-2">
                    {t('skins.skinName')}
                  </label>
                  <SearchStyleInput
                    value={previewSkinName}
                    onChange={(e) => setPreviewSkinName(e.target.value)}
                    placeholder={t('skins.enterSkinName')}
                    disabled={isLoading}
                  />
                </div>

                {/* Skin Variant Selection */}
                <div>
                  <p className="font-minecraft text-3xl text-white/80 lowercase mb-4">
                    {t('skins.skinVariant')}
                  </p>
                  <div className="flex justify-center gap-6">
                    <Checkbox
                      checked={!isSlimVariant}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setIsSlimVariant(false);
                        }
                      }}
                      disabled={isLoading}
                      label={t('skins.classicSteve')}
                      size="md"
                    />
                    <Checkbox
                      checked={isSlimVariant}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setIsSlimVariant(true);
                        }
                      }}
                      disabled={isLoading}
                      label={t('skins.slimAlex')}
                      size="md"
                    />
                  </div>
                </div>
              </div>
            )}

            {!skin && (
              <div className="space-y-2">
                <label className="block font-minecraft text-3xl text-white/80 lowercase">
                  {t('skins.skin')}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="skinInputField"
                    value={skinInput}
                    onChange={(e) => setSkinInput(e.target.value)}
                    placeholder={t('skins.skinInputPlaceholder')}
                    disabled={isLoading}
                    size="md"
                    variant="flat"
                    className="flex-grow"
                  />
                  <IconButton
                    onClick={handleOpenFileUpload}
                    title={t('skins.uploadSkinFromFile')}
                    disabled={isLoading}
                    size="md"
                    variant="flat-secondary"
                    icon={<Icon icon="solar:folder-bold" className="w-5 h-5" />}
                  />
                </div>
              </div>
            )}

          </div>
        )}
      </Modal>
    );
  },
);
