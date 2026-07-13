import {
  Icon as IconifyIcon,
  addCollection,
  addIcon,
  InlineIcon,
} from "@iconify/react/dist/offline.js";
import type { IconProps } from "@iconify/react/dist/offline.js";
import { useEffect } from "react";
import "./icon-bundle";

export { addCollection, addIcon, InlineIcon };
export type { IconProps };
export type {
  IconifyIconProps,
  IconifyIconCustomisations,
  IconifyIconSize,
  IconifyRenderMode,
} from "@iconify/react/dist/offline.js";

export function loadIcons(_icons: string[]): void {}

const warned = new Set<string>();

function IconPlaceholder({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  useEffect(() => {
    if (!import.meta.env.DEV || warned.has(name)) return;
    warned.add(name);
    console.warn(`[iconify] "${name}" is not in the offline bundle — run \`yarn icons\`.`);
  }, [name]);

  return <svg className={className} style={style} width="1em" height="1em" aria-hidden="true" />;
}

export function Icon(props: IconProps) {
  if (props.children) return <IconifyIcon {...props} />;

  const name = typeof props.icon === "string" ? props.icon : "inline icon data";
  return (
    <IconifyIcon {...props}>
      <IconPlaceholder name={name} className={props.className} style={props.style} />
    </IconifyIcon>
  );
}
