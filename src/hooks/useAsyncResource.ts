import { useEffect, useState, type DependencyList } from "react";

export interface AsyncResource<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

export interface AsyncResourceOptions<T> {
  cacheKey?: string;
  hydrate?: () => Promise<T | null>;
  isEqual?: (previous: T, next: T) => boolean;
}

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

function readCache<T>(key: string | undefined): T | undefined {
  return key !== undefined && cache.has(key) ? (cache.get(key) as T) : undefined;
}

function defaultIsEqual<T>(previous: T, next: T): boolean {
  if (Object.is(previous, next)) return true;
  try {
    return JSON.stringify(previous) === JSON.stringify(next);
  } catch {
    return false;
  }
}

function matchesPrefix(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}:`);
}

function fetchDeduplicated<T>(key: string | undefined, fetcher: () => Promise<T>): Promise<T> {
  if (key === undefined) return fetcher();
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = fetcher().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function invalidateAsyncResource(keyPrefix: string): void {
  for (const map of [cache, inflight]) {
    for (const key of map.keys()) {
      if (matchesPrefix(key, keyPrefix)) map.delete(key);
    }
  }
}

export function useAsyncResource<T>(
  fetcher: (() => Promise<T>) | null,
  deps: DependencyList,
  fallback: T,
  options: AsyncResourceOptions<T> = {},
): AsyncResource<T> {
  const { cacheKey, hydrate, isEqual = defaultIsEqual } = options;

  const [state, setState] = useState<AsyncResource<T>>(() => {
    const cached = readCache<T>(cacheKey);
    return { data: cached ?? fallback, loading: fetcher !== null && cached === undefined, error: null };
  });

  useEffect(() => {
    if (!fetcher) {
      setState({ data: fallback, loading: false, error: null });
      return;
    }

    let alive = true;
    let fresh = false;
    let known = readCache<T>(cacheKey);

    const commit = (data: T) => {
      if (cacheKey !== undefined) cache.set(cacheKey, data);
      known = data;
      if (alive) setState({ data, loading: false, error: null });
    };

    if (known !== undefined) {
      commit(known);
    } else {
      setState((s) => ({ ...s, loading: true, error: null }));
      hydrate?.()
        .then((data) => {
          if (data !== null && !fresh) commit(data);
        })
        .catch(() => undefined);
    }

    fetchDeduplicated(cacheKey, fetcher)
      .then((data) => {
        fresh = true;
        if (known === undefined || !isEqual(known, data)) commit(data);
      })
      .catch((err: unknown) => {
        fresh = true;
        if (!alive) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState((s) => ({ data: known ?? fallback, loading: false, error }));
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
