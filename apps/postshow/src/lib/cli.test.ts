import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOURCE_CLI_COMMAND, SOURCE_CLI_INSTALL, workspaceApiUrl } from './cli';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('source CLI commands', () => {
  it('runs the entry point the install snippet actually builds', () => {
    expect(SOURCE_CLI_INSTALL).toContain('git clone https://github.com/eventools-io/postshow.git');
    expect(SOURCE_CLI_INSTALL).toContain('pnpm --filter postshow build');
    expect(SOURCE_CLI_COMMAND).toBe('node ~/postshow/packages/postshow-cli/dist/index.js');
    expect(SOURCE_CLI_INSTALL).toContain('~/postshow');
  });

  it('carries no placeholder a partner would have to guess at', () => {
    expect(SOURCE_CLI_COMMAND).not.toMatch(/absolute|path\/to|<|>/i);
  });
});

describe('workspaceApiUrl', () => {
  it('returns the bare origin the CLI appends the gateway path to', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co/functions/v1/postshow-api');

    expect(workspaceApiUrl()).toBe('https://project.supabase.co');
  });

  it('reports nothing rather than a guess when the origin is unusable', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'project.supabase.co');

    expect(workspaceApiUrl()).toBe('');
  });
});
