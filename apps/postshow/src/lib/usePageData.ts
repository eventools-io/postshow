import { useCallback, useEffect, useState } from 'react';

interface PageData<T> {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

/** Fetch-on-mount with manual reload. Refetches when `fetcher` identity
 * changes (callers memoize it against workspace id). */
export function usePageData<T>(fetcher: () => Promise<T>): PageData<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}
