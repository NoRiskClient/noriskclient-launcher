import { useCallback, useState, type MouseEvent } from "react";
import { SettingsContextMenu, type ContextMenuItem } from "./SettingsContextMenu";

interface OpenMenu<T> {
  target: T;
  position: { x: number; y: number };
}

export function useCardContextMenu<T>() {
  const [menu, setMenu] = useState<OpenMenu<T> | null>(null);

  const open = useCallback((target: T, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ target, position: { x: event.clientX, y: event.clientY } });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return { menu, open, close };
}

interface CardContextMenuProps<T> {
  menu: OpenMenu<T> | null;
  items: ContextMenuItem<T>[];
  onClose: () => void;
}

export function CardContextMenu<T>({ menu, items, onClose }: CardContextMenuProps<T>) {
  if (!menu) return null;
  return <SettingsContextMenu target={menu.target} isOpen position={menu.position} items={items} onClose={onClose} compact />;
}
