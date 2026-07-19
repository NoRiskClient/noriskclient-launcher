"use client";

import React from 'react';
import { Icon } from '@iconify/react';

export function StableIcon({
  icon,
  className = "",
  style,
  onClick,
}: {
  icon: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`flex-shrink-0 inline-flex items-center justify-center ${className}`}
      style={style}
      onClick={onClick}
    >
      <Icon icon={icon} />
    </div>
  );
}
