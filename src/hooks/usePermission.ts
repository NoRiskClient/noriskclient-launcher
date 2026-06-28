import { useEffect, useState } from "react";
import { hasPermission } from "../services/permission-service";

export function usePermission(node: string): boolean {
  const [allowed, setAllowed] = useState(false);

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
  }, [node]);

  return allowed;
}
