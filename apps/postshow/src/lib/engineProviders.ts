import { CATALOG } from '@eventools/postshow-core';
import type { EngineProvider, EngineSettings } from './types';

export function providersForMode(mode: EngineSettings['mode']) {
  if (mode === 'hosted') return CATALOG.filter((provider) => provider.hosted);
  if (mode === 'local') {
    return CATALOG.filter((provider) => provider.id === 'ollama' || provider.id === 'compatible');
  }
  return CATALOG.filter((provider) => provider.requiresKey && provider.id !== 'ollama');
}

export function fallbackProvider(mode: EngineSettings['mode']): EngineProvider {
  return mode === 'local' ? 'ollama' : 'anthropic';
}
