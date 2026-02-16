"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { ModrinthService } from "../../services/modrinth-service";
import type { ModrinthCategory, ModrinthGameVersion, ModrinthLoader, ModrinthProjectType } from "../../types/modrinth";
import { LoadingIndicator } from "../ui/LoadingIndicator";
import { ErrorMessage } from "../ui/ErrorMessage";
import { useThemeStore } from "../../store/useThemeStore";

// Simple FilterGroup component
const FilterGroup = ({ title, children }: { title: string, children: React.ReactNode }) => (
  <div className="space-y-2">
    <h3 className="font-minecraft-ten text-lg mb-1 text-white/80 uppercase tracking-wide">{title}</h3>
    <div className="pl-2 space-y-1.5">{children}</div>
  </div>
);

// Simple Accordion component
const Accordion = ({ title, defaultOpen = false, children }: { title: string, defaultOpen?: boolean, children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="mb-4">
      <div 
        className="flex justify-between items-center cursor-pointer py-2 border-b border-white/10"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h3 className="font-minecraft text-2xl text-white/80 tracking-wide lowercase select-none">{title}</h3>
        <button>
          <Icon icon={isOpen ? "pixel:chevron-up" : "pixel:chevron-down"} className="w-5 h-5 text-white/70" />
        </button>
      </div>
      {isOpen && <div className="pt-3">{children}</div>}
    </div>
  );
};

// Simple CheckboxItem component
const CheckboxItem = ({ 
  id, 
  label, 
  checked, 
  onChange 
}: { 
  id: string, 
  label: string, 
  checked: boolean, 
  onChange: (checked: boolean) => void 
}) => {
  const accentColor = useThemeStore((state) => state.accentColor);
  return (
    <label 
      htmlFor={id} 
      className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded-sm transition-colors"
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <div 
        className={`w-4 h-4 border border-white/20 flex items-center justify-center ${checked ? 'bg-white/20' : ''}`}
        style={{ borderColor: checked ? accentColor.value : '' }}
      >
        {checked && <Icon icon="pixel:check" className="w-3 h-3" style={{ color: accentColor.value }} />}
      </div>
      <span className="text-white/70 font-minecraft-ten tracking-wider">{label}</span>
    </label>
  );
};

interface ModrinthFiltersProps {
  projectType: ModrinthProjectType;
  onFilterChange?: (categories: string[]) => void;
  onGameVersionChange?: (versions: string[]) => void;
  onLoaderChange?: (loaders: string[]) => void;
  onEnvironmentChange?: (environments: string[]) => void;
}

export const ModrinthFilters: React.FC<ModrinthFiltersProps> = ({
  projectType,
  onFilterChange,
  onGameVersionChange,
  onLoaderChange,
  onEnvironmentChange,
}) => {
  const { t } = useTranslation();
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categories, setCategories] = useState<ModrinthCategory[]>([]);
  const [filteredCategories, setFilteredCategories] = useState<ModrinthCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const [selectedGameVersions, setSelectedGameVersions] = useState<string[]>([]);
  const [gameVersions, setGameVersions] = useState<ModrinthGameVersion[]>([]);
  const [gameVersionsLoading, setGameVersionsLoading] = useState(false);
  const [gameVersionsError, setGameVersionsError] = useState<string | null>(null);

  const [selectedLoaders, setSelectedLoaders] = useState<string[]>([]);
  const [loaders, setLoaders] = useState<ModrinthLoader[]>([]);
  const [filteredLoaders, setFilteredLoaders] = useState<ModrinthLoader[]>([]);
  const [loadersLoading, setLoadersLoading] = useState(false);
  const [loadersError, setLoadersError] = useState<string | null>(null);

  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>([]);
  const accentColor = useThemeStore((state) => state.accentColor);

  // Group categories by header
  const groupedCategories = filteredCategories.reduce((acc, category) => {
    const header = category.header;
    if (!acc[header]) {
      acc[header] = [];
    }
    acc[header].push(category);
    return acc;
  }, {} as Record<string, ModrinthCategory[]>);

  // Filter for only major game versions
  const majorGameVersions = gameVersions
    .filter(v => v.major)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Load categories
  useEffect(() => {
    const loadCategories = async () => {
      setCategoriesLoading(true);
      setCategoriesError(null);

      try {
        const categoriesData = await ModrinthService.getModrinthCategories();
        setCategories(categoriesData);
      } catch (error) {
        console.error("Failed to load categories:", error);
        setCategoriesError(
          `Failed to load categories: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        setCategoriesLoading(false);
      }
    };

    loadCategories();
  }, []);

  // Filter categories based on projectType
  useEffect(() => {
    if (categories.length > 0) {
      const filtered = categories.filter(
        category => category.project_type === projectType
      );
      setFilteredCategories(filtered);

      // Clear selected categories when project type changes
      setSelectedCategories([]);
      if (onFilterChange) {
        onFilterChange([]);
      }
    }
  }, [categories, projectType, onFilterChange]);

  // Load game versions
  useEffect(() => {
    const loadGameVersions = async () => {
      setGameVersionsLoading(true);
      setGameVersionsError(null);

      try {
        const versionsData = await ModrinthService.getModrinthGameVersions();
        setGameVersions(versionsData);
      } catch (error) {
        console.error("Failed to load game versions:", error);
        setGameVersionsError(
          `Failed to load game versions: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        setGameVersionsLoading(false);
      }
    };

    loadGameVersions();
  }, []);

  // Load loaders
  useEffect(() => {
    const loadLoaders = async () => {
      setLoadersLoading(true);
      setLoadersError(null);

      try {
        const loadersData = await ModrinthService.getModrinthLoaders();
        setLoaders(loadersData);
      } catch (error) {
        console.error("Failed to load loaders:", error);
        setLoadersError(
          `Failed to load loaders: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        setLoadersLoading(false);
      }
    };

    loadLoaders();
  }, []);

  // Filter loaders based on projectType
  useEffect(() => {
    if (loaders.length > 0) {
      const filtered = loaders.filter(
        loader => loader.supported_project_types.includes(projectType)
      );
      setFilteredLoaders(filtered);

      // Clear selected loaders when project type changes if not compatible
      if (projectType !== "mod" && projectType !== "modpack") {
        setSelectedLoaders([]);
        if (onLoaderChange) {
          onLoaderChange([]);
        }
      }
    }
  }, [loaders, projectType, onLoaderChange]);

  const handleCategoryChange = useCallback((category: string, checked: boolean) => {
    setSelectedCategories(prev => {
      const updated = checked
        ? [...prev, category]
        : prev.filter(cat => cat !== category);
      
      if (onFilterChange) {
        onFilterChange(updated);
      }
      
      return updated;
    });
  }, [onFilterChange]);

  const handleGameVersionChange = useCallback((version: string, checked: boolean) => {
    setSelectedGameVersions(prev => {
      const updated = checked
        ? [...prev, version]
        : prev.filter(v => v !== version);
      
      if (onGameVersionChange) {
        onGameVersionChange(updated);
      }
      
      return updated;
    });
  }, [onGameVersionChange]);

  const handleLoaderChange = useCallback((loader: string, checked: boolean) => {
    setSelectedLoaders(prev => {
      const updated = checked
        ? [...prev, loader]
        : prev.filter(l => l !== loader);
      
      if (onLoaderChange) {
        onLoaderChange(updated);
      }
      
      return updated;
    });
  }, [onLoaderChange]);

  const handleEnvironmentChange = useCallback((env: string, checked: boolean) => {
    setSelectedEnvironments(prev => {
      const updated = checked
        ? [...prev, env]
        : prev.filter(e => e !== env);
      
      if (onEnvironmentChange) {
        onEnvironmentChange(updated);
      }
      
      return updated;
    });
  }, [onEnvironmentChange]);

  return (
    <div 
      className="h-full p-4 rounded-lg border-2 border-b-4 shadow-md overflow-y-auto custom-scrollbar"
      style={{
        backgroundColor: `${accentColor.value}10`,
        borderColor: `${accentColor.value}40`,
        borderBottomColor: `${accentColor.value}60`
      }}
    >
      <h2 className="font-minecraft text-3xl mb-4 tracking-wide text-white/90 lowercase select-none">{t('modrinth.filters')}</h2>

      <Accordion title={t('modrinth.categories')} defaultOpen>
        {categoriesLoading ? (
          <LoadingIndicator message={t('modrinth.loading_categories')} />
        ) : categoriesError ? (
          <ErrorMessage message={categoriesError} />
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedCategories).map(([header, cats]) => (
              <FilterGroup key={header} title={header}>
                {cats.map(category => (
                  <CheckboxItem
                    key={category.name}
                    id={`category-${category.name}`}
                    label={category.name.replace(/-/g, ' ')}
                    checked={selectedCategories.includes(category.name)}
                    onChange={checked => handleCategoryChange(category.name, checked)}
                  />
                ))}
              </FilterGroup>
            ))}
          </div>
        )}
      </Accordion>

      <Accordion title={t('modrinth.game_versions')} defaultOpen>
        {gameVersionsLoading ? (
          <LoadingIndicator message={t('modrinth.loading_versions')} />
        ) : gameVersionsError ? (
          <ErrorMessage message={gameVersionsError} />
        ) : (
          <div className="space-y-2">
            {majorGameVersions.map(version => (
              <CheckboxItem
                key={version.version}
                id={`version-${version.version}`}
                label={version.version}
                checked={selectedGameVersions.includes(version.version)}
                onChange={checked => handleGameVersionChange(version.version, checked)}
              />
            ))}
          </div>
        )}
      </Accordion>

      {(projectType === "mod" || projectType === "modpack") && (
        <Accordion title={t('modrinth.mod_loaders')} defaultOpen>
          {loadersLoading ? (
            <LoadingIndicator message={t('modrinth.loading_loaders')} />
          ) : loadersError ? (
            <ErrorMessage message={loadersError} />
          ) : (
            <div className="space-y-2">
              {filteredLoaders.map(loader => (
                <CheckboxItem
                  key={loader.name}
                  id={`loader-${loader.name}`}
                  label={loader.name}
                  checked={selectedLoaders.includes(loader.name)}
                  onChange={checked => handleLoaderChange(loader.name, checked)}
                />
              ))}
            </div>
          )}
        </Accordion>
      )}

      <Accordion title={t('modrinth.environment')} defaultOpen>
        <div className="space-y-2">
          <CheckboxItem
            id="environment-client"
            label={t('content.filters.client')}
            checked={selectedEnvironments.includes("client")}
            onChange={checked => handleEnvironmentChange("client", checked)}
          />
          <CheckboxItem
            id="environment-server"
            label={t('content.filters.server')}
            checked={selectedEnvironments.includes("server")}
            onChange={checked => handleEnvironmentChange("server", checked)}
          />
        </div>
      </Accordion>
    </div>
  );
}; 