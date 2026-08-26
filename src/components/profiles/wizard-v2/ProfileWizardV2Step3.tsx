"use client";

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import type { ModLoader } from "../../../types/profile";
import { Modal } from "../../ui/Modal";
import { Button } from "../../ui/buttons/Button";
import { StatusMessage } from "../../ui/StatusMessage";
import { useThemeStore } from "../../../store/useThemeStore";
import { SearchStyleInput } from "../../ui/Input";
import { RangeSlider } from "../../ui/RangeSlider";
import { Card } from "../../ui/Card";
import { Checkbox } from "../../ui/Checkbox";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { NoriskModEntryDefinition, NoriskModpacksConfig, NoriskPackDefinition } from "../../../types/noriskPacks";
import { loadPacks, usePacks } from "../../../hooks/usePacks";
import { useTranslation } from "react-i18next";
import { useGlobalModal } from "../../../hooks/useGlobalModal";
import { IconPicker, handleIconImgLoad, type ChosenIcon } from "../IconPicker";
import { getRandomBlockIcon } from "../../../data/block-icons";
import { getDefaultMemoryMaxMb, getSystemRamMb } from "../../../services/profile-service";
import { logError } from "../../../utils/logging-utils";
import { parseErrorMessage } from "../../../utils/error-utils";

const forbiddenChars = /[<>:"/\\|?*]/g;
const forbiddenTrailing = /[ .]$/;

interface ProfileWizardV2Step3Props {
    onClose: () => void;
    onBack: () => void;
    onCreate: (profileData: {
        name: string;
        group: string | null;
        minecraftVersion: string;
        loader: ModLoader;
        loaderVersion: string | null;
        memoryMaxMb: number;
        selectedNoriskPackId: string | null;
        use_shared_minecraft_folder?: boolean;
        chosenIcon: ChosenIcon;
    }) => void;
    selectedMinecraftVersion: string;
    selectedLoader: ModLoader;
    selectedLoaderVersion: string | null;
    defaultGroup?: string | null;
}

export function ProfileWizardV2Step3({
    onClose,
    onBack,
    onCreate,
    selectedMinecraftVersion,
    selectedLoader,
    selectedLoaderVersion,
    defaultGroup
}: ProfileWizardV2Step3Props) {
    const { t } = useTranslation();
    const accentColor = useThemeStore((state) => state.accentColor);
    const { showModal, hideModal } = useGlobalModal();
    const [chosenIcon, setChosenIcon] = useState<ChosenIcon>(() => ({ url: getRandomBlockIcon().url }));
    const [profileName, setProfileName] = useState("");
    const [profileGroup, setProfileGroup] = useState(defaultGroup || "");
    const [memoryMaxMb, setMemoryMaxMb] = useState<number>(0);
    const [systemRamMb, setSystemRamMb] = useState<number>(16384);
    const [recommendedRam, setRecommendedRam] = useState<number>(0);
    const [selectedNoriskPackId, setSelectedNoriskPackId] = useState<string | null>(null);
    const { packs: noriskPacks, loading: packsLoading } = usePacks();
    const [packCompatibilityWarning, setPackCompatibilityWarning] = useState<string | null>(null);
    const [showYellowWarning, setShowYellowWarning] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [useSharedMinecraftFolder, setUseSharedMinecraftFolder] = useState(
        defaultGroup && defaultGroup.toLowerCase() !== "modpacks"
    ); // Default to true when group exists and is not "modpacks"
    const effectiveMemoryMaxMb = memoryMaxMb || recommendedRam || 4096;

    useEffect(() => {
        let cancelled = false;
        const loadMemoryDefaults = async () => {
            try {
                const [systemRam, recommended] = await Promise.all([
                    getSystemRamMb(),
                    getDefaultMemoryMaxMb(),
                ]);
                if (cancelled) return;
                setSystemRamMb(systemRam);
                setRecommendedRam(recommended);
                setMemoryMaxMb((current) => (current === 0 ? recommended : current));
            } catch (e) {
                logError(`[ProfileWizard] Failed to load memory defaults: ${e}`);
                if (cancelled) return;
                setRecommendedRam(4096);
                setMemoryMaxMb((current) => (current === 0 ? 4096 : current));
            }
        };
        loadMemoryDefaults();
        return () => {
            cancelled = true;
        };
    }, []);

    // Update profile group when defaultGroup changes
    useEffect(() => {
        if (defaultGroup && !profileGroup) {
            setProfileGroup(defaultGroup);
        }
    }, [defaultGroup]);

    // Update shared Minecraft folder setting when defaultGroup changes
    useEffect(() => {
        setUseSharedMinecraftFolder(
            defaultGroup && defaultGroup.toLowerCase() !== "modpacks"
        );
    }, [defaultGroup]);

    const [checkingCompatibility, setCheckingCompatibility] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const defaultNoriskPackId = noriskPacks["norisk-prod"]
        ? "norisk-prod"
        : Object.keys(noriskPacks)[0] ?? null;

    useEffect(() => {
        if (defaultNoriskPackId) setSelectedNoriskPackId(defaultNoriskPackId);
    }, [defaultNoriskPackId]);

    const getLoaderDisplayName = (loader: ModLoader) => {
        const names = {
            vanilla: "Vanilla",
            fabric: "Fabric",
            forge: "Forge",
            neoforge: "NeoForge",
            quilt: "Quilt"
        };
        return names[loader] || loader;
    };

    const handleMemoryChange = (value: number) => {
        setMemoryMaxMb(value);
    };


    // Check pack compatibility when selection changes
    useEffect(() => {
        const checkPackCompatibility = async () => {
            if (!selectedNoriskPackId || selectedNoriskPackId === "") {
                setPackCompatibilityWarning(null);
                setShowYellowWarning(false);
                return;
            }

            setCheckingCompatibility(true);
            setPackCompatibilityWarning(null);
            setShowYellowWarning(false);

            try {
                // Get resolved packs with all mods
                const resolvedPacks = { packs: await loadPacks() };

                // Check if the selected pack has NoRisk Client mods for this version/loader
                const selectedPack = resolvedPacks.packs[selectedNoriskPackId];

                if (!selectedPack) {
                    setShowYellowWarning(true);
                    return;
                }

                // Get the mods in the pack
                const mods = selectedPack.mods || [];

                // Check if any NoRisk Client mod exists and is compatible with the selected version/loader
                const hasCompatibleNoRiskClient = mods.some((mod: NoriskModEntryDefinition) => {
                    // Check if this is a NoRisk Client mod
                    if (mod.id === "noriskclient-client" || mod.id === "nrc-client") {
                        // Check if it has compatibility for the selected version and loader
                        const versionCompat = mod.compatibility?.[selectedMinecraftVersion];
                        const loaderCompat = versionCompat?.[selectedLoader];
                        console.log(`Checking mod ${mod.id} compatibility:`, {
                            version: selectedMinecraftVersion,
                            loader: selectedLoader,
                            versionCompat,
                            loaderCompat,
                            hasCompat: !!loaderCompat
                        });
                        return !!loaderCompat; // Returns true if compatibility exists
                    }
                    return false;
                });

                console.log("Pack mods for", selectedNoriskPackId, selectedMinecraftVersion, selectedLoader, ":", mods);
                console.log("Has compatible NoRisk Client:", hasCompatibleNoRiskClient);

                if (!hasCompatibleNoRiskClient) {
                    setShowYellowWarning(true);
                }
            } catch (err) {
                console.warn("Failed to check pack compatibility:", err);
                setShowYellowWarning(true);
            } finally {
                setCheckingCompatibility(false);
            }
        };

        checkPackCompatibility();
    }, [selectedNoriskPackId, selectedMinecraftVersion, selectedLoader]);

    // Auto-generate profile name based on loader and minecraft version
    useEffect(() => {
        const generateProfileName = () => {
            const loaderName = getLoaderDisplayName(selectedLoader);
            return `${loaderName} ${selectedMinecraftVersion}`;
        };

        setProfileName(generateProfileName());
    }, [selectedLoader, selectedMinecraftVersion]);

    const openIconPicker = () => {
        showModal("profile-icon-picker", (
            <IconPicker
                selected={chosenIcon}
                onSelect={setChosenIcon}
                onClose={() => hideModal("profile-icon-picker")}
            />
        ), 1100);
    };

    const handleCreate = async () => {
        if (!profileName.trim()) {
            setError(t('profiles.wizard.nameRequired'));
            return;
        }

        setCreating(true);
        setError(null);

        try {
            await onCreate({
                name: profileName.trim(),
                group: profileGroup.trim() || null,
                minecraftVersion: selectedMinecraftVersion,
                loader: selectedLoader,
                loaderVersion: selectedLoaderVersion,
                memoryMaxMb: effectiveMemoryMaxMb,
                selectedNoriskPackId: selectedNoriskPackId,
                use_shared_minecraft_folder: useSharedMinecraftFolder,
                chosenIcon: chosenIcon
            });
        } catch (err) {
            console.error("Failed to create profile:", err);
            setError(t('profiles.wizard.createError', { error: parseErrorMessage(err) }));
        } finally {
            setCreating(false);
        }
    };

    // ProfileName ForbiddenCharacter Event Handler
    const [profileCharRemoved, setProfileCharRemoved] = useState(false);
    const [profileNameHasForbiddenEnding, setProfileNameHasForbiddenEnding] = useState(false);

    const handleProfileNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        const cleanValue = value.replace(forbiddenChars, "");

        if (value !== cleanValue) {
            setProfileCharRemoved(true);
        }

        setProfileNameHasForbiddenEnding(forbiddenTrailing.test(cleanValue));

        setProfileName(cleanValue);
    };

    const renderContent = () => {
        if (error) {
            return <StatusMessage type="error" message={error} />;
        }

        const iconPreviewSrc = "url" in chosenIcon ? chosenIcon.url : convertFileSrc(chosenIcon.path);

        return (
            <div className="space-y-8">
                {/* Profile Details */}
                <div className="flex gap-4 items-end">
                    {/* Profile Icon — no label so it doesn't add a row that offsets the inputs */}
                    <button
                        type="button"
                        onClick={openIconPicker}
                        title={t('profiles.wizard.profileIcon')}
                        className="w-[52px] h-[52px] flex-shrink-0 rounded-lg border-2 overflow-hidden flex items-center justify-center bg-black/30 hover:scale-105 transition-transform"
                        style={{ borderColor: `${accentColor.value}80` }}
                    >
                        <img
                            src={iconPreviewSrc}
                            alt=""
                            className="w-full h-full object-cover"
                            onLoad={handleIconImgLoad}
                        />
                    </button>
                    <div className="grid grid-cols-2 gap-4 flex-1">
                    <div className="space-y-2">
                        <label className="block text-base font-minecraft text-white/50">
                            {t('profiles.wizard.profileName')}
                        </label>
                        <SearchStyleInput
                            value={profileName}
                            onChange={handleProfileNameChange}
                            placeholder={t('profiles.wizard.enterProfileName')}
                            required
                        />
                        {profileCharRemoved && (
                            <p className="text-xs text-red-400 font-minecraft mt-1">
                                {t('profiles.wizard.forbiddenChars')}
                            </p>
                        )}
                        {profileNameHasForbiddenEnding && (
                            <p className="text-xs text-red-400 font-minecraft mt-1">
                                {t('profiles.wizard.forbiddenEnding')}
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="block text-base font-minecraft text-white/50">
                            {t('profiles.wizard.groupOptional')}
                        </label>
                        <SearchStyleInput
                            value={profileGroup}
                            onChange={(e) => setProfileGroup(e.target.value)}
                            placeholder={t('profiles.wizard.enterGroupName')}
                        />
                    </div>
                    </div>
                </div>

                {/* Checkbox Options */}
                <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                        <Checkbox
                            label={t('profiles.wizard.useSharedFolder')}
                            checked={useSharedMinecraftFolder}
                            onChange={(event) => setUseSharedMinecraftFolder(event.target.checked)}
                            description={t('profiles.wizard.sharedFolderDescription')}
                            descriptionClassName="font-minecraft text-sm"
                            size="lg"
                        />
                        <p className="text-xs text-white/50 font-minecraft ml-10 -mt-1">
                            {t('profiles.wizard.canChangeAnytime')}
                        </p>
                    </div>
                </div>

                {/* RAM Settings */}
                <div className="space-y-3">
                    <label className="block text-base font-minecraft text-white/50">
                        {t('profiles.wizard.recommendedRam', { ram: recommendedRam || 4096 })}
                    </label>
                    <RangeSlider
                        value={effectiveMemoryMaxMb}
                        onChange={handleMemoryChange}
                        min={1024}
                        max={systemRamMb}
                        step={512}
                        valueLabel={`${effectiveMemoryMaxMb} MB (${(effectiveMemoryMaxMb / 1024).toFixed(1)} GB)`}
                        minLabel="1 GB"
                        maxLabel={`${systemRamMb} MB`}
                        variant="flat"
                        recommendedRange={[4096, 8192]}
                        unit="MB"
                    />
                </div>

                {/* NoRisk Client features */}
                <div className="space-y-2">
                    <Checkbox
                        label={t('profiles.wizard.useNrcFeatures')}
                        checked={Boolean(selectedNoriskPackId)}
                        onChange={(event) =>
                            setSelectedNoriskPackId(
                                event.target.checked ? defaultNoriskPackId : null,
                            )
                        }
                        size="lg"
                        disabled={packsLoading || !defaultNoriskPackId}
                    />

                    {showYellowWarning ? (
                        <p className="text-sm text-yellow-400 font-minecraft">
                            {t('profiles.wizard.nrcIncompatibleWarning')}
                        </p>
                    ) : (
                        <p className="text-sm text-white/50 font-minecraft">
                            {t('profiles.wizard.noriskPackDescription')}
                        </p>
                    )}

                    {checkingCompatibility && (
                        <div className="flex items-center gap-2 text-white/70">
                            <Icon icon="svg-spinners:ring-resize" className="w-4 h-4" />
                            <span className="text-sm font-minecraft">
                                {t('profiles.wizard.checkingCompatibility')}
                            </span>
                        </div>
                    )}

                    {packCompatibilityWarning && (
                        <Card
                            variant="flat"
                            className="p-3 bg-red-900/20 border border-red-500/30"
                        >
                            <div className="flex items-start gap-2">
                                <Icon
                                    icon="solar:danger-triangle-bold"
                                    className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5"
                                />
                                <p className="text-xs text-red-300 font-minecraft">
                                    {packCompatibilityWarning}
                                </p>
                            </div>
                        </Card>
                    )}
                </div>
            </div>
        );
    };

    const renderFooter = () => (
        <div className="flex justify-between items-center">
            <Button
                variant="secondary"
                onClick={onBack}
                disabled={creating}
                size="md"
                className="text-sm"
                icon={<Icon icon="solar:arrow-left-bold" className="w-5 h-5" />}
                iconPosition="left"
            >
                {t('profiles.wizard.back')}
            </Button>

            <Button
                variant="success"
                onClick={handleCreate}
                disabled={
                    creating ||
                    !profileName.trim() ||
                    profileNameHasForbiddenEnding
                }
                size="md"
                className="min-w-[180px] text-sm"
                icon={
                    creating ? (
                        <Icon icon="svg-spinners:ring-resize" className="w-5 h-5" />
                    ) : (
                        <Icon icon="solar:check-circle-bold" className="w-5 h-5" />
                    )
                }
                iconPosition="left"
            >
                {creating ? t('profiles.wizard.creating') : t('profiles.wizard.createProfile')}
            </Button>
        </div>
    );

    return (
        <Modal
            title={t('profiles.wizard.step3Title')}
            onClose={onClose}
            width="lg"
            footer={renderFooter()}
        >
            <div className="min-h-[500px] p-6 overflow-hidden">
                {renderContent()}
            </div>
        </Modal>
    );
}