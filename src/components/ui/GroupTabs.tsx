import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";

export interface GroupTab {
  /** Unique identifier for the group */
  id: string;
  /** Display name of the group */
  name: string;
  /** Number of items in this group */
  count: number;
  /** Optional icon for the group */
  icon?: string;
}

export interface GroupTabsProps {
  /** Array of group tabs to display */
  groups: GroupTab[];
  /** Currently active group ID */
  activeGroup: string;
  /** Callback when a group is selected */
  onGroupChange: (groupId: string) => void;
  /** Whether to show the "Add Group" button */
  showAddButton?: boolean;
  /** Callback when the "Add Group" button is clicked */
  onAddGroup?: () => void;
  /** Additional CSS classes */
  className?: string;
  /** Custom add button text */
  addButtonText?: string;
  /** Custom add button icon */
  addButtonIcon?: string;
  vertical?: boolean;
}

export function GroupTabs({
  groups,
  activeGroup,
  onGroupChange,
  showAddButton = true,
  onAddGroup,
  className = "",
  addButtonText = "ADD GROUP",
  addButtonIcon = "solar:add-circle-bold",
  vertical = false,
}: GroupTabsProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  const handleGroupClick = (groupId: string) => {
    onGroupChange(groupId);
  };

  const handleAddGroupClick = () => {
    onAddGroup?.();
  };

  if (vertical) {
    return (
      <div className={className}>
        <div className="flex flex-col">
          {groups.map((group) => {
            const active = activeGroup === group.id;
            return (
              <button
                key={group.id}
                onClick={() => handleGroupClick(group.id)}
                className={`relative w-full flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded text-left font-minecraft text-sm uppercase tracking-wide transition-colors ${
                  active ? "text-white bg-white/10" : "text-white/55 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon icon={group.icon ?? "solar:folder-bold"} className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{group.name}</span>
                <span className="text-xs text-white/40 tabular-nums">{group.count}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={`mb-4 ${className}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {groups.map((group) => (
          <button
            key={group.id}
            onClick={() => handleGroupClick(group.id)}
            className={`px-3 py-1 rounded-lg font-smallcaps text-lg transition-all duration-200 flex items-center gap-2 border-2 ${
              activeGroup === group.id
                ? 'text-white'
                : 'text-white/70 bg-black/30 hover:bg-black/40 border-white/10 hover:border-white/20'
            }`}
            style={{
              backgroundColor: activeGroup === group.id ? `${accentColor.value}20` : undefined,
              borderColor: activeGroup === group.id ? accentColor.value : undefined,
            }}
          >
            {group.icon && (
              <Icon icon={group.icon} className="w-4 h-4" />
            )}
            <span>{group.name}</span>
          </button>
        ))}
        
        {/* Add Group Button */}
        {showAddButton && (
          <button
            onClick={handleAddGroupClick}
            className="px-3 py-1 rounded-lg border border-dashed border-white/30 hover:border-white/50 text-white/50 hover:text-white/70 transition-all duration-200 flex items-center gap-2"
          >
            <Icon icon={addButtonIcon} className="w-4 h-4" />
            <span className="font-smallcaps text-lg transform -translate-y-0.5">{addButtonText}</span>
          </button>
        )}
      </div>
    </div>
  );
}
