"use client";

import type React from "react";
import { Icon } from "@iconify/react";

interface EmptyStateV3Props {
  icon: string;
  title: string;
  hint?: string;
}

export const EmptyStateV3: React.FC<EmptyStateV3Props> = ({ icon, title, hint }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
      <Icon icon={icon} className="w-8 h-8 text-white/40" />
    </div>
    <div className="text-white/70 font-minecraft-ten text-sm">{title}</div>
    {hint && <div className="text-white/35 font-minecraft-ten text-xs mt-1">{hint}</div>}
  </div>
);
