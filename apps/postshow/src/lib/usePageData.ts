import { useCallback, useEffect, useState } from 'react';

interface PageData<T> {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

interface PageDataState<T> {
  fetcher: () => Promise<T>;
  data: T | null;
  loading: boolean;
  error: string;
}

/** Fetch-on-mount with manual reload. Refetches when `fetcher` identity
 * changes (callers memoize it against workspace id). */
export function usePageData<T>(fetcher: () => Promise<T>): PageData<T> {
  const [state, setState] = useState<PageDataState<T>>({
    fetcher,
    data: null,
    loading: true,
    error: '',
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({
      fetcher,
      data: previous.fetcher === fetcher ? previous.data : null,
      loading: true,
      error: '',
    }));
    Promise.resolve()
      .then(fetcher)
      .then((result) => {
        if (!cancelled) setState({ fetcher, data: result, loading: false, error: '' });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            fetcher,
            data: null,
            loading: false,
            error: e instanceof Error ? e.message : 'Failed to load',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const owned = state.fetcher === fetcher;

  return {
    data: owned ? state.data : null,
    loading: owned ? state.loading : true,
    error: owned ? state.error : '',
    reload,
  };
}
