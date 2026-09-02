import { useEffect, useState, type DependencyList } from "react";

export interface AsyncResource<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

export function useAsyncResource<T>(
  fetcher: (() => Promise<T>) | null,
  deps: DependencyList,
  fallback: T,
): AsyncResource<T> {
  const [state, setState] = useState<AsyncResource<T>>({
    data: fallback,
    loading: fetcher !== null,
    error: null,
  });

  useEffect(() => {
    if (!fetcher) {
      setState({ data: fallback, loading: false, error: null });
      return;
    }

    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    fetcher()
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ data: fallback, loading: false, error });
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
