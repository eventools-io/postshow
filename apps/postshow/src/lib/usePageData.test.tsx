import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePageData } from './usePageData';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe({ fetcher }: { fetcher: () => Promise<string> }) {
  const { data, loading, error } = usePageData(fetcher);
  return (
    <div>
      <span data-testid="data">{data ?? 'none'}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error || 'none'}</span>
    </div>
  );
}

describe('usePageData request ownership', () => {
  it('hides stale data immediately when the fetcher changes', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const firstFetcher = () => first.promise;
    const secondFetcher = () => second.promise;
    const view = render(<Probe fetcher={firstFetcher} />);

    first.resolve('workspace A data');
    expect(await screen.findByText('workspace A data')).toBeInTheDocument();

    view.rerender(<Probe fetcher={secondFetcher} />);
    expect(screen.getByTestId('data')).toHaveTextContent('none');
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    second.resolve('workspace B data');
    expect(await screen.findByText('workspace B data')).toBeInTheDocument();
    expect(screen.queryByText('workspace A data')).not.toBeInTheDocument();
  });

  it('never accepts a superseded request that resolves after the new request', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const firstFetcher = () => first.promise;
    const secondFetcher = () => second.promise;
    const view = render(<Probe fetcher={firstFetcher} />);
    view.rerender(<Probe fetcher={secondFetcher} />);

    second.resolve('workspace B data');
    expect(await screen.findByText('workspace B data')).toBeInTheDocument();
    first.resolve('workspace A late response');
    await Promise.resolve();

    expect(screen.getByTestId('data')).toHaveTextContent('workspace B data');
    expect(screen.queryByText('workspace A late response')).not.toBeInTheDocument();
  });

  it('surfaces a synchronous fetcher failure through the normal error state', async () => {
    const fetcher = () => {
      throw new Error('synchronous failure');
    };
    render(<Probe fetcher={fetcher} />);

    expect(await screen.findByText('synchronous failure')).toBeInTheDocument();
    expect(screen.getByTestId('data')).toHaveTextContent('none');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });
});
