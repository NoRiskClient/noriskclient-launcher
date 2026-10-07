import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

interface CapeTemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (withElytra: boolean) => void;
}

/** This page-local menu never downloads until an option is activated. */
export function CapeTemplatePicker({ open, onOpenChange, onSelect }: CapeTemplatePickerProps) {
  const { t } = useTranslation();
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const initialItemRef = useRef(0);

  const close = (restoreFocus = false) => {
    onOpenChange(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    itemsRef.current[initialItemRef.current]?.focus();
    initialItemRef.current = 0;
    const outside = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("focusin", focusOutside);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("focusin", focusOutside);
    };
  }, [open, onOpenChange]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = itemsRef.current.findIndex((item) => item === document.activeElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % 2;
    else if (event.key === "ArrowUp") next = (index - 1 + 2) % 2;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      close(true);
      return;
    }
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (next !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      itemsRef.current[next]?.focus();
    }
    // Forward Tab follows document order; focusOutside dismisses the menu.
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button ref={triggerRef} type="button" aria-label={t("capes.downloadTemplate")} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { initialItemRef.current = 0; onOpenChange(!open); }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          initialItemRef.current = event.key === "ArrowUp" ? 1 : 0;
          if (open) itemsRef.current[initialItemRef.current]?.focus();
          else onOpenChange(true);
        }}
        className="flex items-center gap-2 px-4 py-2 bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded-lg font-smallcaps text-base transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        title={t("capes.downloadTemplate")}>
        <Icon icon="solar:download-bold" className="w-4 h-4" />
        <span>{t("capes.template")}</span>
        <Icon icon="solar:alt-arrow-down-bold" className="w-3 h-3" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={t("capes.downloadTemplate")} onKeyDown={onMenuKeyDown}
          className="absolute top-full left-0 mt-1 z-50 bg-black/80 backdrop-blur-md border border-white/20 rounded-lg overflow-hidden min-w-[180px]">
          {[false, true].map((withElytra, index) => (
            <button key={String(withElytra)} ref={(node) => { itemsRef.current[index] = node; }} type="button" role="menuitem" tabIndex={-1}
              onClick={() => { close(true); onSelect(withElytra); }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-white/70 hover:text-white hover:bg-white/10 focus-visible:text-white focus-visible:bg-white/10 font-smallcaps text-sm transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70">
              <Icon icon="solar:download-bold" className="w-4 h-4" />
              <span>{t(withElytra ? "capes.templateWithElytra" : "capes.templateWithoutElytra")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
