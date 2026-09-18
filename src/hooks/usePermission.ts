import { useEffect, useState } from "react";
import { getGrantedPermissions } from "../services/permission-service";
import { usePermissionStore } from "../store/permission-store";

const NONE: ReadonlySet<string> = new Set();

export function usePermissions(nodes: readonly string[]): ReadonlySet<string> {
  const revision = usePermissionStore((s) => s.revision);
  const [granted, setGranted] = useState<ReadonlySet<string>>(NONE);
  const key = nodes.join("\n");

  useEffect(() => {
    let active = true;
    getGrantedPermissions(key ? key.split("\n") : [])
      .catch(() => [])
      .then((allowed) => {
        if (active) setGranted(new Set(allowed));
      });
    return () => {
      active = false;
    };
  }, [key, revision]);

  return granted;
}

export function usePermission(node: string): boolean {
  return usePermissions([node]).has(node);
}
