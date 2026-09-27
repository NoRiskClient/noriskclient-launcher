"use client";

import { useGlobalModalStore } from "../../hooks/useGlobalModal";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

export function GlobalModalPortal() {
  const { modals } = useGlobalModalStore();
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Ensure we're in the browser
    if (typeof document !== "undefined") {
      setPortalRoot(document.body);
    }
  }, []);

  if (!portalRoot || modals.length === 0) {
    return null;
  }

  return (
    <>
      {modals.map((modal) =>
        createPortal(
          <div
            key={modal.id}
            style={{ zIndex: modal.zIndex }}
            className="fixed inset-0"
          >
            {modal.component}
          </div>,
          portalRoot
        )
      )}
    </>
  );
}
