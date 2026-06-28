import { useEffect, useState } from "react";

/**
 * Liefert erst dann `true`, wenn `active` mindestens `delayMs` am Stück `true`
 * war. Kippt `active` zwischendurch auf `false`, wird der Timer resettet.
 *
 * Typischer Usecase: Loading-Spinner unterdruecken, wenn die Operation so
 * schnell war, dass der Spinner nur "flashen" wuerde. Setze z.B. 500ms —
 * bei Cache-Hits sieht man direkt die Daten, bei echten Waits erst spaet
 * den Spinner.
 */
export function useDelayedTrue(active: boolean, delayMs = 500): boolean {
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!active) {
      setDelayed(false);
      return;
    }
    const t = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);

  return delayed;
}
