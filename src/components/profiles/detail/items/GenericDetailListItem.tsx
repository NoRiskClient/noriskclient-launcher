"use client";

import React, { ReactNode, useState } from 'react';
import { Icon } from '@iconify/react'; // For default icons if needed
import { CheckboxV2 } from '../../../ui/CheckboxV2'; // New checkbox with ActionButton styling

export interface GenericDetailListItemProps {
  id: string;
  isSelected: boolean;
  onSelectionChange: (isSelected: boolean) => void;

  iconNode?: ReactNode;
  title: ReactNode;
  onTitleClick?: () => void;
  descriptionNode?: ReactNode;
  infoItems?: Array<{
    icon?: string;
    text: string;
    color?: string;
    iconFilter?: string;
  }>;
  isDisabled?: boolean;

  mainActionNode?: ReactNode; // e.g., Enable/Disable button
  updateActionNode?: ReactNode; // e.g., Update button
  
  // Individual action buttons (delete, more actions trigger)
  // These will be grouped together.
  deleteActionNode?: ReactNode;
  moreActionsTriggerNode?: ReactNode;
  
  // Alternative: Single actions component (takes precedence over individual action nodes)
  actionsNode?: ReactNode;
  
  // Dropdown content, controlled by the parent via a prop or visibility toggle from moreActionsTriggerNode
  dropdownNode?: ReactNode; 
  isDropdownVisible?: boolean; // Parent controls visibility based on activeDropdownId

  // Visuals / Theming
  accentColor?: string; // For internal theming if necessary
}

export function GenericDetailListItem({
  id,
  isSelected,
  onSelectionChange,
  iconNode,
  title,
  onTitleClick,
  descriptionNode,
  infoItems,
  isDisabled = false,
  mainActionNode,
  updateActionNode,
  deleteActionNode,
  moreActionsTriggerNode,
  actionsNode,
  dropdownNode,
  isDropdownVisible,
  accentColor = '#FFFFFF', // Default accent if not provided
}: GenericDetailListItemProps) {

  const [isHovered, setIsHovered] = useState(false);

  // Determine default icon if none provided (example)
  const defaultIcon = <Icon icon="solar:box-bold-duotone" className="w-10 h-10 text-white/30" />;
  const displayIconNode = iconNode || defaultIcon;

  return (
    <div 
      className="relative flex items-center gap-4 p-3 rounded-lg bg-black/20 border border-white/10 hover:border-white/20 transition-all duration-200 group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Checkbox Area */}
      <div className="flex-shrink-0 self-center" onClick={(e) => e.stopPropagation()}>
        <CheckboxV2
          size="sm"
          checked={isSelected}
          onChange={(checked) => onSelectionChange(checked)}
          tooltip={`Select item ${typeof title === 'string' ? title : id}`}
        />
      </div>

      {/* Icon Area - Smaller and more compact with ProfileCardV2 styling */}
      <div 
        className={`relative w-16 h-16 flex-shrink-0 rounded-lg flex items-center justify-center overflow-hidden border-2 transition-all duration-200 ${isDisabled ? 'opacity-50 grayscale' : ''}`}
        style={{
          backgroundColor: isHovered ? `${accentColor}20` : 'transparent',
          borderColor: isHovered ? `${accentColor}60` : 'transparent',
        }}
      >
        {displayIconNode}
      </div>

      {/* Content Area - Title, Description, Badges */}
      <div className="flex-1 min-w-0">
        <h3
          className={`font-minecraft-ten text-sm whitespace-nowrap overflow-hidden text-ellipsis normal-case mb-1 ${isDisabled ? 'text-white/50 line-through' : 'text-white'} ${onTitleClick ? 'cursor-pointer hover:underline' : ''}`}
          title={typeof title === 'string' ? title : undefined}
          onClick={onTitleClick ? (e) => { e.stopPropagation(); onTitleClick(); } : undefined}
        >
          {title}
        </h3>
        {descriptionNode && (
          <div className={`text-xs font-minecraft-ten mb-1 ${isDisabled ? 'text-white/40' : 'text-white/70'}`}>
            {descriptionNode}
          </div>
        )}
        {infoItems && infoItems.length > 0 && (
          <div className="flex items-center gap-2 text-xs font-minecraft-ten">
            {infoItems.map((item, index) => (
              <React.Fragment key={index}>
                {index > 0 && <div className="w-px h-3 bg-white/30"></div>}
                <div className="flex items-center gap-1" style={{ color: item.color || '#ffffff70' }}>
                  {item.icon && (
                    <img
                      src={item.icon}
                      alt=""
                      className={`w-3 h-3 object-contain ${isDisabled ? 'opacity-50 grayscale' : ''}`}
                      style={item.iconFilter ? { filter: item.iconFilter } : undefined}
                    />
                  )}
                  <span>{item.text}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Actions Area - Main Action, Update, Other Actions */}
      <div className="flex items-center gap-2 flex-shrink-0 relative">
        {actionsNode ? (
          // Use single actions component if provided
          <>
            {actionsNode}
            {isDropdownVisible && dropdownNode}
          </>
        ) : (
          // Use individual action nodes (legacy)
          <>
            {updateActionNode}
            {mainActionNode}
            {/* Group for delete and more actions */}
            {(deleteActionNode || moreActionsTriggerNode) && (
              <div className="flex items-center gap-0.5 relative">
                {deleteActionNode}
                {moreActionsTriggerNode}
                {isDropdownVisible && dropdownNode} 
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
} 