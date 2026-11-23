import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { Button } from "../../ui/buttons/Button";
import { Card } from "../../ui/Card";
import { FileNodeViewer } from "../../file-explorer/FileNodeViewer";
import type { FileNode } from "../../../types/fileSystem";
import * as ProfileService from "../../../services/profile-service";
import { parseErrorMessage } from "../../../utils/error-utils";

const DEFAULT_SELECTION = [
  "resourcepacks",
  "shaderpacks",
  "options.txt",
  "NoRiskClientLauncher",
  "config",
  "custom_mods",
  "mods",
];

const MANAGED_NRC_MODS = /(^|[\/\\])mods[\/\\]nrc-[^\/\\]+$/i;

function withoutManagedMods(node: FileNode): FileNode {
  return { ...node, children: node.children?.filter((child) => !MANAGED_NRC_MODS.test(child.path)).map(withoutManagedMods) };
}

function collectPaths(nodes: FileNode[] | undefined, into = new Set<string>()): Set<string> {
  nodes?.forEach((node) => {
    into.add(node.path);
    collectPaths(node.children, into);
  });
  return into;
}

function withChildren(node: FileNode, path: string, children: FileNode[]): FileNode {
  if (node.path === path) return { ...node, children };
  if (!path.startsWith(node.path)) return node;
  return { ...node, children: node.children?.map((child) => withChildren(child, path, children)) };
}

function ancestorDirs(wanted: string[]): string[] {
  const dirs = wanted.flatMap((path) => {
    const segments = path.split("/").filter(Boolean);
    return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join("/"));
  });
  return [...new Set(dirs)].sort((a, b) => a.length - b.length);
}

const relativeTo = (root: FileNode, node: FileNode) => node.path.slice(root.path.length + 1);

export function ExportFileSelector({
  profileId,
  selected,
  onSelectionChange,
  onLoadingChange,
  only,
}: {
  profileId: string;
  only?: string[];
  selected: Set<string>;
  onSelectionChange: (paths: Set<string>) => void;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const { t } = useTranslation();
  const [structure, setStructure] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  const loadedDirs = useRef(new Set<string>());
  const latest = useRef({ structure, selected, onSelectionChange });
  latest.current = { structure, selected, onSelectionChange };

  const loadLevel = useCallback(
    async (subPath?: string) => {
      const level = await ProfileService.getProfileDirectoryLevel(profileId, subPath);
      loadedDirs.current.add(level.path);
      return only ? withoutManagedMods(level) : level;
    },
    [profileId, only],
  );

  const expandDir = useCallback(
    async (dir: FileNode) => {
      const root = latest.current.structure;
      if (!root || loadedDirs.current.has(dir.path)) return;
      try {
        const level = await loadLevel(relativeTo(root, dir));
        const current = latest.current;
        setStructure((prev) => prev && withChildren(prev, dir.path, level.children ?? []));
        if (current.selected.has(dir.path)) {
          current.onSelectionChange(collectPaths(level.children, new Set(current.selected)));
        }
      } catch (err) {
        toast.error(t("export.load_structure_failed", { error: parseErrorMessage(err) }));
      }
    },
    [loadLevel, t],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loadedDirs.current = new Set();
    const load = async () => {
      let tree = await loadLevel();
      for (const dir of ancestorDirs(only ?? DEFAULT_SELECTION)) {
        const level = await loadLevel(dir).catch(() => null);
        if (level) tree = withChildren(tree, level.path, level.children ?? []);
      }
      return tree;
    };
    load()
      .then((result) => {
        if (alive) setStructure(result);
      })
      .catch((err) => {
        if (!alive) return;
        const message = t("export.load_structure_failed", { error: parseErrorMessage(err) });
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadLevel, only, t]);

  return (
    <>
      <div className="flex gap-2 mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelectionChange(collectPaths(structure?.children))}
          disabled={loading || !structure?.children?.length}
          icon={<Icon icon="solar:check-read-outline" className="w-4 h-4" />}
          className="text-xs px-3 py-1.5"
        >
          {t("common.select_all")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelectionChange(new Set())}
          disabled={loading || selected.size === 0}
          icon={<Icon icon="solar:close-circle-outline" className="w-4 h-4" />}
          className="text-xs px-3 py-1.5"
        >
          {t("export.deselect_all")}
        </Button>
      </div>
      <Card
        variant="flat"
        className="p-3 bg-black/20 border border-white/10 max-h-64 min-h-64 overflow-y-auto custom-scrollbar"
      >
        <FileNodeViewer
          rootNode={structure}
          loading={loading}
          error={error}
          selectedFiles={selected}
          onSelectionChange={onSelectionChange}
          checkboxesEnabled={true}
          hideRootNode={true}
          preSelectPaths={only ?? DEFAULT_SELECTION}
          selectChildrenWithParent={true}
          onExpandDir={expandDir}
          defaultRootCollapsed={false}
          className="text-sm"
        />
      </Card>
    </>
  );
}
