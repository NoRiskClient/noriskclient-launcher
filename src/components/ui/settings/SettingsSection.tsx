"use client";

import { Children, Fragment, cloneElement, isValidElement, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../../lib/utils";
import { useThemeStore } from "../../../store/useThemeStore";
import { fuzzyMatch, useSettingsSearch } from "./SettingsSearchContext";

interface SettingsSectionProps {
  id?: string;
  title: string;
  description?: ReactNode;
  icon?: string;
  headerActions?: ReactNode;
  keywords?: string[];
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** React fragments are structural, not settings rows; inspect their actual children. */
export function filterSettingsRows(children: ReactNode, query: string): ReactNode[] {
  const visit = (nodes: ReactNode, prefix: string): ReactNode[] => Children.toArray(nodes).flatMap((child, index) => {
    if (!isValidElement(child)) return [];
    const key = `${prefix}/${child.key ?? index}`;
    const props = child.props as { children?: ReactNode; label?: unknown; searchKeywords?: string[] };
    if (child.type === Fragment) return visit(props.children, key);
    const hay = [typeof props.label === "string" ? props.label : "", ...(props.searchKeywords ?? [])].join(" ");
    return fuzzyMatch(hay, query) ? [cloneElement(child, { key })] : [];
  });
  return visit(children, "settings");
}

export function SettingsSection({
  id,
  title,
  description,
  icon,
  headerActions,
  keywords,
  children,
  className,
  bodyClassName,
}: SettingsSectionProps) {
  const accentColor = useThemeStore((s) => s.accentColor);
  const query = useSettingsSearch();

  let body: ReactNode = children;

  if (query) {
    const sectionHay = [title, ...(keywords ?? [])].join(" ");
    const sectionMatch = fuzzyMatch(sectionHay, query);

    if (!sectionMatch) {
      const kept = filterSettingsRows(children, query);
      if (kept.length === 0) return null;
      body = kept;
    }
  }

  return (
    <section id={id} className={cn("scroll-mt-4", className)}>
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          {icon && (
            <Icon
              icon={icon}
              className="w-6 h-6 flex-shrink-0"
              style={{ color: accentColor.value }}
            />
          )}
          <h3
            className="font-smallcaps text-lg leading-none tracking-wide"
            style={{ color: accentColor.value }}
          >
            {title}
          </h3>
        </div>
        {headerActions && <div className="flex-shrink-0">{headerActions}</div>}
      </div>

      {description && (
        <p className="font-minecraft text-xs text-white/45 mt-2">{description}</p>
      )}

      <div className={cn("mt-1", bodyClassName)}>{body}</div>
    </section>
  );
}
