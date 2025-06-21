"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '../../lib/utils';
import type { FileNode } from '../../types/fileSystem'; // Adjust path as necessary
import { Checkbox } from '../ui/Checkbox'; // Adjust path as necessary
import { useThemeStore } from '../../store/useThemeStore'; // For styling consistency if needed

// Helper to format file size
export function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024) return `${sizeInBytes} B`;
  if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KB`;
  if (sizeInBytes < 1024 * 1024 * 1024) return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Helper to format date
export function formatDate(timestamp: number | null): string {
  if (timestamp === null) return 'N/A';
  // Assuming timestamp is in seconds, convert to milliseconds for Date constructor
  return new Date(timestamp * 1000).toLocaleString();
}

interface FileNodeItemProps {
  node: FileNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: (path: string, event?: React.MouseEvent) => void;
  onNodeSelected: (node: FileNode, event: React.MouseEvent | React.ChangeEvent<HTMLInputElement>) => void;
  checkboxesEnabled: boolean;
  isBackgroundAnimationEnabled: boolean;
  expandedNodes: Set<string>; 
  selectedFiles: Set<string>;
}

const FileNodeItem: React.FC<FileNodeItemProps> = ({
  node,
  depth: currentDepth,
  isExpanded: currentIsExpanded,
  isSelected: currentIsSelected,
  onToggleExpand,
  onNodeSelected,
  checkboxesEnabled,
  isBackgroundAnimationEnabled,
  expandedNodes,
  selectedFiles,
}) => {
  const accentColor = useThemeStore((state) => state.accentColor);
  const [isHovered, setIsHovered] = useState(false);

  const handleContentDivClick = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('.filenode-checkbox-area')) {
        event.stopPropagation();
        return;
    }

    if (node.is_dir) {
        onToggleExpand(node.path, event); 
    } else if (!checkboxesEnabled) {
        onNodeSelected(node, event);
    }
  };  const handleCheckboxChange = (event: any) => {
    if (event.stopPropagation) {
      event.stopPropagation();
    }
    onNodeSelected(node, event);
  };

  return (
    <li
      className={cn(
        'file-node list-none',
        node.is_dir ? 'directory' : 'file',
      )}
      style={{ paddingLeft: `${currentDepth * 1.5}rem` }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div 
        className={cn(
            "node-content flex items-center py-1 pr-2 transition-colors duration-150",
            {"cursor-pointer": node.is_dir || !checkboxesEnabled || checkboxesEnabled && !node.is_dir },
        )}
        onClick={handleContentDivClick}
        style={{
          backgroundColor: 
            currentIsSelected && checkboxesEnabled ? `${accentColor.value}30` : 
            (isHovered && (node.is_dir || !checkboxesEnabled)) ? `${accentColor.value}1A` : 
            'transparent'
        }}
      >
        {node.is_dir ? (
          <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(node.path, e);
            }}
            className="expand-toggle-button p-0.5 mr-1 text-white/70 hover:text-white flex-shrink-0"
            aria-label={currentIsExpanded ? 'Collapse' : 'Expand'}
          >
            <Icon icon={currentIsExpanded ? "solar:alt-arrow-down-bold" : "solar:alt-arrow-right-bold"} className="w-4 h-4" />
          </button>
        ) : (
          <span className="expand-placeholder w-[20px] mr-1 flex-shrink-0"></span>
        )}        {checkboxesEnabled && (
          <div className="filenode-checkbox-area mr-2 flex-shrink-0 self-center">
            <Checkbox
              checked={currentIsSelected}
              onChange={handleCheckboxChange}
              customSize="sm"
            />
          </div>
        )}

        <Icon icon={node.is_dir ? "solar:folder-bold" : "solar:document-bold"} className="w-4 h-4 mr-2 flex-shrink-0 text-white/90 self-center" />
        
        <span 
            className={cn(
              "node-name flex-1 truncate text-sm font-minecraft-ten self-center", 
              {"cursor-pointer": node.is_dir || checkboxesEnabled && !node.is_dir }
            )}
            onClick={(e) => {
                e.stopPropagation();
                if (node.is_dir) {
                    onToggleExpand(node.path, e);
                } else if (checkboxesEnabled) {
                    onNodeSelected(node, e);
                } 
            }}
        >
          {node.name}
        </span>

        {!node.is_dir && (
          <span className="node-size text-xs text-white/60 font-minecraft-ten w-[70px] text-right mr-2 tabular-nums flex-shrink-0 self-center">
            {formatFileSize(node.size)}
          </span>
        )}
        <span className="node-date text-xs text-white/60 font-minecraft-ten w-[150px] text-right tabular-nums flex-shrink-0 self-center">
          {formatDate(node.last_modified)}
        </span>
      </div>

      {node.is_dir && currentIsExpanded && node.children && node.children.length > 0 && (
        <ul className="file-children list-none p-0 mt-0.5">
          {node.children.map((childNode) => (
            <FileNodeItem
              key={childNode.path}
              node={childNode}
              depth={currentDepth + 1}
              isExpanded={expandedNodes.has(childNode.path)}
              isSelected={selectedFiles.has(childNode.path)}
              onToggleExpand={onToggleExpand}
              onNodeSelected={onNodeSelected}
              checkboxesEnabled={checkboxesEnabled}
              isBackgroundAnimationEnabled={isBackgroundAnimationEnabled}
              expandedNodes={expandedNodes}
              selectedFiles={selectedFiles}
            />
          ))}
        </ul>
      )}
    </li>
  );
};


export interface FileNodeViewerProps {
  rootNode: FileNode | null;
  loading: boolean;
  error: string | null;
  selectedFiles: Set<string>;
  onSelectionChange: (newSelectedFiles: Set<string>) => void;
  checkboxesEnabled?: boolean;
  preSelectPaths?: string[];
  selectChildrenWithParent?: boolean;
  hideRootNode?: boolean;
  defaultRootCollapsed?: boolean;
  className?: string;
}

export const FileNodeViewer: React.FC<FileNodeViewerProps> = ({
  rootNode,
  loading,
  error,
  selectedFiles,
  onSelectionChange,
  checkboxesEnabled = true,
  preSelectPaths = [],
  selectChildrenWithParent = true,
  hideRootNode = false,
  defaultRootCollapsed = false,
  className,
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [initialSetupDone, setInitialSetupDone] = useState(false);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);


  const addNodeAndChildren = useCallback((node: FileNode, selectedSet: Set<string>) => {
    selectedSet.add(node.path);
    if (node.is_dir && node.children) {
      for (const child of node.children) {
        addNodeAndChildren(child, selectedSet);
      }
    }
  }, []);

  const removeNodeAndChildren = useCallback((node: FileNode, selectedSet: Set<string>) => {
    selectedSet.delete(node.path);
    if (node.is_dir && node.children) {
      for (const child of node.children) {
        removeNodeAndChildren(child, selectedSet);
      }
    }
  }, []);

  useEffect(() => {
    if (rootNode && !initialSetupDone) {
      const newExpanded = new Set<string>();
      const newSelected = new Set(selectedFiles); // Start with current selectedFiles from props
      let fireSelectionChange = false;

      const applyPreSelectionRecursive = (node: FileNode) => {
        let nodeMatchedByPreselect = false;
        if (preSelectPaths.length > 0) {
          for (const pattern of preSelectPaths) {
            if (node.path.includes(pattern)) {
              nodeMatchedByPreselect = true;
              if (selectChildrenWithParent && node.is_dir) {
                addNodeAndChildren(node, newSelected);
              } else {
                newSelected.add(node.path);
              }
              break;
            }
          }
        }

        if (node.is_dir && node.children) {
          if (!nodeMatchedByPreselect || !selectChildrenWithParent) {
            node.children.forEach(applyPreSelectionRecursive);
          }
        }
      };

      if (!hideRootNode && rootNode.path && !defaultRootCollapsed) {
        newExpanded.add(rootNode.path);
      }

      const nodesForPreselection = hideRootNode
        ? rootNode.children || []
        : [rootNode];
      nodesForPreselection.forEach(applyPreSelectionRecursive);

      if (
        newSelected.size !== selectedFiles.size ||
        ![...newSelected].every((path) => selectedFiles.has(path))
      ) {
        fireSelectionChange = true;
      }

      setExpandedNodes(newExpanded);
      if (fireSelectionChange) {
        onSelectionChange(newSelected);
      }
      setInitialSetupDone(true);
    }
  }, [
    rootNode,
    preSelectPaths,
    selectChildrenWithParent,
    defaultRootCollapsed,
    hideRootNode,
    addNodeAndChildren,
    onSelectionChange,
    initialSetupDone,
    selectedFiles,
  ]);


  const handleToggleExpand = useCallback((path: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    setExpandedNodes((prevExpanded) => {
      const newExpanded = new Set(prevExpanded);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      return newExpanded;
    });
  }, []);  const handleNodeSelected = useCallback((node: FileNode, event: React.MouseEvent | React.ChangeEvent<HTMLInputElement>) => {
    if (event.stopPropagation) {
      event.stopPropagation();
    }
    const newSelectedFiles = new Set(selectedFiles);
    
    let targetNodeIsNowSelected: boolean;

    if ('target' in event && event.target && 'checked' in event.target) {
        targetNodeIsNowSelected = (event.target as any).checked;
    } else {
        const isCurrentlySelected = selectedFiles.has(node.path);
        targetNodeIsNowSelected = !isCurrentlySelected;
    }

    if (targetNodeIsNowSelected) {
        if (node.is_dir && selectChildrenWithParent) {
            addNodeAndChildren(node, newSelectedFiles);
        } else {
            newSelectedFiles.add(node.path);
        }
    } else {
        if (node.is_dir && selectChildrenWithParent) {
            removeNodeAndChildren(node, newSelectedFiles);
        } else {
            newSelectedFiles.delete(node.path);
        }
    }
    onSelectionChange(newSelectedFiles);
  }, [selectedFiles, onSelectionChange, selectChildrenWithParent, addNodeAndChildren, removeNodeAndChildren]);


  const renderNodeRecursive = (node: FileNode, depth: number): JSX.Element => {
    return (
      <FileNodeItem
        key={node.path}
        node={node}
        depth={depth}
        isExpanded={expandedNodes.has(node.path)}
        isSelected={selectedFiles.has(node.path)}
        onToggleExpand={handleToggleExpand}
        onNodeSelected={handleNodeSelected}
        checkboxesEnabled={checkboxesEnabled}
        isBackgroundAnimationEnabled={isBackgroundAnimationEnabled}
        expandedNodes={expandedNodes}
        selectedFiles={selectedFiles}
      />
    );
  };

  if (loading) {
    return <div className="p-4 text-center text-white/70 font-minecraft-ten">Loading file structure...</div>;
  }

  if (error) {
    return <div className="p-4 text-center text-red-400 font-minecraft-ten">Error: {error}</div>;
  }

  if (!rootNode) {
    return <div className="p-4 text-center text-white/70 font-minecraft-ten">No file structure available.</div>;
  }

  const nodesToRender = hideRootNode ? rootNode.children || [] : [rootNode];

  return (
    <ul className={cn("file-tree list-none p-0 m-0", className)}>
      {nodesToRender.map((node) => renderNodeRecursive(node, 0))}
    </ul>
  );
}; 