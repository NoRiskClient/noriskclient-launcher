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
import { Select } from "../../ui/Select";
import { Card } from "../../ui/Card";
import { Checkbox } from "../../ui/Checkbox";
import { invoke } from "@tauri-apps/api/core";
import { NoriskModEntryDefinition, NoriskModpacksConfig } from "../../../types/noriskPacks";
import { useTranslation } from "react-i18next";

const forbiddenChars = /[<>:"/\\|?*]/g;
const forbiddenTrailing = /[ .]$/;

interface NoriskPack {
    displayName: string;
    description: string;
    isExperimental?: boolean;
}

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
    const [profileName, setProfileName] = useState("");
    const [profileGroup, setProfileGroup] = useState(defaultGroup || "");
    const [memoryMaxMb, setMemoryMaxMb] = useState<number>(3072); // 3GB default
    const [systemRamMb] = useState<number>(16384); // 16GB default for slider range
    const recommendedRam = systemRamMb <= 8192 ? Math.min(2048, systemRamMb) : Math.min(4096, systemRamMb);
    const [selectedNoriskPackId, setSelectedNoriskPackId] = useState<string | null>(null);
    const [noriskPacks, setNoriskPacks] = useState<Record<string, NoriskPack>>({});
    const [loadingPacks, setLoadingPacks] = useState(false);
    const [packCompatibilityWarning, setPackCompatibilityWarning] = useState<string | null>(null);
    const [showYellowWarning, setShowYellowWarning] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [useSharedMinecraftFolder, setUseSharedMinecraftFolder] = useState(
        defaultGroup && defaultGroup.toLowerCase() !== "modpacks"
    ); // Default to true when group exists and is not "modpacks"
    const [showAllVersions, setShowAllVersions] = useState(false); // Default to false to show only curated versions

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

    // Load NoRisk packs on component mount
    useEffect(() => {
        const loadNoriskPacks = async () => {
            try {
                setLoadingPacks(true);
                const packsData = await invoke<{ packs: Record<string, NoriskPack> }>(
                    "get_norisk_packs_resolved",
                ).catch(() => ({
                    packs: {},
                }));
                console.log("PACKS", packsData);
                setNoriskPacks(packsData.packs);

                // Auto-select "norisk-prod" if available
                if (packsData.packs["norisk-prod"]) {
                    setSelectedNoriskPackId("norisk-prod");
                }
            } catch (err) {
                console.error("Failed to load NoRisk packs:", err);
            } finally {
                setLoadingPacks(false);
            }
        };

        loadNoriskPacks();
    }, []);

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

    const noriskPackOptions = Object.entries(noriskPacks)
        .filter(([packId]) => {
            if (showAllVersions) return true; // Show all versions when checkbox is checked
            // Show only curated versions when checkbox is unchecked
            return packId === "norisk-prod" || packId === "norisk-bughunter" || packId === "";
        })
        .map(([packId, packDef]) => ({
            value: packId,
            label: `${packDef.displayName} ${packDef.isExperimental ? "(experimental)" : ""}`,
        }));

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
                const resolvedPacks = await invoke<NoriskModpacksConfig>(
                    "get_norisk_packs_resolved"
                );

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
                memoryMaxMb: memoryMaxMb,
                selectedNoriskPackId: selectedNoriskPackId,
                use_shared_minecraft_folder: useSharedMinecraftFolder
            });
        } catch (err) {
            console.error("Failed to create profile:", err);
            setError(t('profiles.wizard.createError', { error: err instanceof Error ? err.message : String(err) }));
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

        return (
            <div className="space-y-8">
                {/* Profile Details */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="block text-base font-minecraft-ten text-white/50">
                            {t('profiles.wizard.profileName')}
                        </label>
                        <SearchStyleInput
                            value={profileName}
                            onChange={handleProfileNameChange}
                            placeholder={t('profiles.wizard.enterProfileName')}
                            required
                        />
                        {profileCharRemoved && (
                            <p className="text-xs text-red-400 font-minecraft-ten mt-1">
                                {t('profiles.wizard.forbiddenChars')}
                            </p>
                        )}
                        {profileNameHasForbiddenEnding && (
                            <p className="text-xs text-red-400 font-minecraft-ten mt-1">
                                {t('profiles.wizard.forbiddenEnding')}
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="block text-base font-minecraft-ten text-white/50">
                            {t('profiles.wizard.groupOptional')}
                        </label>
                        <SearchStyleInput
                            value={profileGroup}
                            onChange={(e) => setProfileGroup(e.target.value)}
                            placeholder={t('profiles.wizard.enterGroupName')}
                        />
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
                            descriptionClassName="font-minecraft-ten text-sm"
                            size="lg"
                        />
                        <p className="text-xs text-white/50 font-minecraft-ten ml-10 -mt-1">
                            {t('profiles.wizard.canChangeAnytime')}
                        </p>
                    </div>
                </div>

                {/* RAM Settings */}
                <div className="space-y-3">
                    <label className="block text-base font-minecraft-ten text-white/50">
                        {t('profiles.wizard.recommendedRam', { ram: recommendedRam })}
                    </label>
                    <RangeSlider
                        value={memoryMaxMb}
                        onChange={handleMemoryChange}
                        min={1024}
                        max={systemRamMb}
                        step={512}
                        valueLabel={`${memoryMaxMb} MB (${(memoryMaxMb / 1024).toFixed(1)} GB)`}
                        minLabel="1 GB"
                        maxLabel={`${systemRamMb} MB`}
                        variant="flat"
                        recommendedRange={[4096, 8192]}
                        unit="MB"
                    />
                </div>

                {/* Advanced Settings */}
                <div className="space-y-3">
                    <button
                        onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                        className="flex items-center justify-between w-full p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
                    >
                        <span className="text-base font-minecraft-ten text-white/80">
                            {t('profiles.wizard.advancedSettings')}
                        </span>
                        <Icon
                            icon={showAdvancedSettings ? "solar:chevron-up-bold" : "solar:chevron-down-bold"}
                            className="w-5 h-5 text-white/60"
                        />
                    </button>

                    {showAdvancedSettings && (
                        <div className="space-y-4 p-4 bg-white/5 border border-white/10 rounded-lg">
                            {/* NoRisk Pack Selection */}
                            <div className="space-y-3">
                                <label className="block text-base font-minecraft-ten text-white/50">
                                    {t('profiles.wizard.noriskClientPack')}
                                </label>
                                <p className="text-sm text-white/60 font-minecraft-ten">
                                    {t('profiles.wizard.noriskPackDescription')}
                                </p>
                                {loadingPacks ? (
                                    <div className="flex items-center gap-2 text-white/70">
                                        <Icon
                                            icon="solar:refresh-bold"
                                            className="w-4 h-4 animate-spin"
                                        />
                                        <span className="text-sm font-minecraft-ten">
                                            {t('profiles.wizard.loadingPacks')}
                                        </span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex gap-3">
                                            <div className="flex-1">
                                                <Select
                                                    value={selectedNoriskPackId || ""}
                                                    onChange={(value) => setSelectedNoriskPackId(value === "" ? null : value)}
                                                    options={[
                                                        { value: "", label: t('profiles.wizard.noneOptional') },
                                                        ...noriskPackOptions,
                                                    ]}
                                                    placeholder={t('profiles.wizard.selectNoriskPack')}
                                                    size="md"
                                                    className="w-full"
                                                />
                                            </div>
                                            <div className="flex items-center">
                                                <Checkbox
                                                    checked={showAllVersions}
                                                    onChange={(event) => setShowAllVersions(event.target.checked)}
                                                    label={t('profiles.wizard.showAllVersions')}
                                                    size="sm"
                                                    className="text-white/70"
                                                />
                                            </div>
                                        </div>
                                        {/* Show either warning, none hint, or description */}
                                        {showYellowWarning ? (
                                            <div className="text-center">
                                                <p className="text-base text-yellow-400 font-minecraft-ten">
                                                    {t('profiles.wizard.nrcIncompatibleWarning')}
                                                </p>
                                            </div>
                                        ) : selectedNoriskPackId === null || selectedNoriskPackId === "" ? (
                                            <div className="text-center">
                                                <p className="text-sm text-amber-400 font-minecraft-ten">
                                                    {t('profiles.wizard.noNrcFeatures')}
                                                </p>
                                            </div>
                                        ) : (
                                            selectedNoriskPackId && noriskPacks[selectedNoriskPackId] && (
                                                <div className="text-center">
                                                    <p className="text-sm text-white/70 font-minecraft-ten">
                                                        {noriskPacks[selectedNoriskPackId].description}
                                                    </p>
                                                </div>
                                            )
                                        )}

                                        {/* Compatibility Checking */}
                                        {checkingCompatibility && (
                                            <div className="flex items-center gap-2 text-white/70">
                                                <Icon
                                                    icon="solar:refresh-bold"
                                                    className="w-4 h-4 animate-spin"
                                                />
                                                <span className="text-sm font-minecraft-ten">
                                                    {t('profiles.wizard.checkingCompatibility')}
                                                </span>
                                            </div>
                                        )}

                                        {/* Compatibility Warning */}
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
                                                    <p className="text-xs text-red-300 font-minecraft-ten">
                                                        {packCompatibilityWarning}
                                                    </p>
                                                </div>
                                            </Card>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
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
                className="text-xl"
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
                className="min-w-[180px] text-xl"
                icon={
                    creating ? (
                        <Icon icon="solar:refresh-bold" className="w-5 h-5 animate-spin" />
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