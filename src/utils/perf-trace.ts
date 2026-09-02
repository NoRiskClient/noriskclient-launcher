import { logInfo } from './logging-utils';

const starts = new Map<string, number>();

export function traceStart(scope: string): void {
  starts.set(scope, performance.now());
  logInfo(`[perf:${scope}] +0ms START`);
}

export function traceMark(scope: string | undefined, label: string): void {
  if (!scope) return;
  const t0 = starts.get(scope);
  if (t0 === undefined) return;

  const delta = performance.now() - t0;
  if (delta > 10_000) return;

  logInfo(`[perf:${scope}] +${Math.round(delta)}ms ${label}`);
}
