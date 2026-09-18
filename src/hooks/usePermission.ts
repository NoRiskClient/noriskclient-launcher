import { useEffect, useState } from "react";
import { hasPermission } from "../services/permission-service";
import { usePermissionStore } from "../store/permission-store";

export function usePermission(node: string): boolean {
  const [allowed, setAllowed] = useState(false);
  const revision = usePermissionStore((s) => s.revision);

  useEffect(() => {
    let active = true;
    hasPermission(node)
      .then((v) => {
        if (active) setAllowed(v);
      })
      .catch(() => {
        if (active) setAllowed(false);
      });
    return () => {
      active = false;
    };
  }, [node, revision]);

  return allowed;
}
