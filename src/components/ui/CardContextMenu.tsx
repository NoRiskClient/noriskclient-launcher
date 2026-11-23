import { useCallback, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { SettingsContextMenu, clampMenuPosition, type ContextMenuItem } from "./SettingsContextMenu";

const ITEM_HEIGHT = 36;

interface OpenMenu<T> {
  target: T;
  position: { x: number; y: number };
}

export function useCardContextMenu<T>() {
  const [menu, setMenu] = useState<OpenMenu<T> | null>(null);

  const open = useCallback((target: T, event: MouseEvent, itemCount: number) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ target, position: clampMenuPosition(event.clientX, event.clientY, itemCount * ITEM_HEIGHT + 16) });
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
  return createPortal(
    <SettingsContextMenu target={menu.target} isOpen position={menu.position} items={items} onClose={onClose} compact />,
    document.body,
  );
}
