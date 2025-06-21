"use client";

import { ReactNode } from "react";

interface GenericListItemProps {
  icon?: ReactNode;
  content: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;  className?: string;
}

export function GenericListItem({
  icon,
  content,
  actions,
  onClick,  className = "p-4 flex items-start gap-4 hover:bg-white/5 transition-colors",
}: GenericListItemProps) {
  const clickableProps = onClick ? { onClick, role: "button", tabIndex: 0 } : {};

  return (
    <li className={className} {...clickableProps}>      {icon && (
        <div className="relative w-24 h-24 flex-shrink-0">
          {icon}
        </div>
      )}

      <div className="flex-grow min-w-0 h-24 flex flex-col justify-between overflow-hidden">
        {content}
      </div>

      {actions && (
        <div className="flex-shrink-0 h-24 flex flex-col items-end justify-center gap-1">
          {actions}
        </div>
      )}
    </li>
  );
} 