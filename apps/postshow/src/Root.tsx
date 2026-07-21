import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppErrorBoundary, clearChunkReloadMarker } from './components/AppErrorBoundary';

export function Root() {
  useEffect(() => {
    const timer = window.setTimeout(clearChunkReloadMarker, 5_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <BrowserRouter>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </BrowserRouter>
  );
}
