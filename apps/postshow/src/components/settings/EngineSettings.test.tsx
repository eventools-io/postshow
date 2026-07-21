import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EngineSection, TaskMatrixSection } from '@/pages/SettingsPage';
import { providersForMode } from '@/lib/engineProviders';
import { fetchKeyProviders, setEngine, setTaskPrefs } from '@/lib/api';
import type { EngineSettings } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  fetchKeyProviders: vi.fn(),
  setEngine: vi.fn(),
  setTaskPrefs: vi.fn(),
  fetchApiTokens: vi.fn(),
  fetchEngine: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
  setAgentRules: vi.fn(),
  setEngineKey: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const keys = vi.mocked(fetchKeyProviders);
const saveEngine = vi.mocked(setEngine);
const savePrefs = vi.mocked(setTaskPrefs);
const baseEngine: EngineSettings = {
  workspace_id: 'workspace-1',
  mode: 'byok',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  base_url: '',
  task_prefs: {},
};

describe('engine mode UI contracts', () => {
  beforeEach(() => {
    keys.mockReset().mockResolvedValue([]);
    saveEngine.mockReset().mockResolvedValue(undefined);
    savePrefs.mockReset().mockResolvedValue(undefined);
  });

  it('exposes only providers that the selected mode can execute', () => {
    expect(providersForMode('hosted').map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
    ]);
    expect(providersForMode('local').map((provider) => provider.id)).toEqual([
      'compatible',
      'ollama',
    ]);
    expect(providersForMode('byok').map((provider) => provider.id)).not.toContain('ollama');
  });

  it('requires a compatible endpoint model and key bound to the exact target', async () => {
    const user = userEvent.setup();
    render(<EngineSection workspaceId="workspace-1" engine={baseEngine} reload={vi.fn()} />);
    await waitFor(() => expect(keys).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/default provider/i), 'compatible');
    await user.type(screen.getByLabelText(/default model/i), 'custom-model');
    await user.type(screen.getByLabelText(/^base url$/i), 'https://models.example/v1');
    expect(screen.getByLabelText(/endpoint api key/i)).toBeRequired();
    await user.type(screen.getByLabelText(/endpoint api key/i), 'secret-key');
    await user.click(screen.getByRole('button', { name: /save engine/i }));

    await waitFor(() =>
      expect(saveEngine).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        mode: 'byok',
        provider: 'compatible',
        model: 'custom-model',
        baseUrl: 'https://models.example/v1',
        apiKey: 'secret-key',
      })
    );
  });

  it('persists the canonical compatible target and does not rotate a key for equivalent URL text', async () => {
    const user = userEvent.setup();
    keys.mockResolvedValue(['compatible']);
    const compatibleEngine: EngineSettings = {
      ...baseEngine,
      provider: 'compatible',
      model: 'custom-model',
      base_url: 'https://xn--mnich-kva.example/v1',
    };
    render(<EngineSection workspaceId="workspace-1" engine={compatibleEngine} reload={vi.fn()} />);
    await waitFor(() => expect(keys).toHaveBeenCalled());

    const input = screen.getByLabelText(/^base url$/i);
    await user.clear(input);
    await user.type(input, 'https://MÜNICH.example:443/v1///');
    expect(screen.getByLabelText(/endpoint api key/i)).not.toBeRequired();
    await user.click(screen.getByRole('button', { name: /save engine/i }));

    await waitFor(() =>
      expect(saveEngine).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        mode: 'byok',
        provider: 'compatible',
        model: 'custom-model',
        baseUrl: 'https://xn--mnich-kva.example/v1',
        apiKey: null,
      })
    );
    expect(input).toHaveValue('https://xn--mnich-kva.example/v1');
  });

  it('rejects credential-bearing and non-loopback engine endpoints before saving', async () => {
    const user = userEvent.setup();
    render(<EngineSection workspaceId="workspace-1" engine={baseEngine} reload={vi.fn()} />);
    await waitFor(() => expect(keys).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/default provider/i), 'compatible');
    await user.type(screen.getByLabelText(/default model/i), 'custom-model');
    await user.type(screen.getByLabelText(/^base url$/i), 'https://user:secret@models.example/v1');
    await user.type(screen.getByLabelText(/endpoint api key/i), 'secret-key');
    await user.click(screen.getByRole('button', { name: /save engine/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot contain credentials/i);
    expect(saveEngine).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/^base url$/i));
    await user.type(screen.getByLabelText(/^base url$/i), 'https://models.example:8443/v1');
    await user.click(screen.getByRole('button', { name: /save engine/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/standard-port public HTTPS/i);
    expect(saveEngine).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/^base url$/i));
    fireEvent.change(screen.getByLabelText(/^base url$/i), {
      target: { value: 'https://[fd00::1]/v1' },
    });
    await user.click(screen.getByRole('button', { name: /save engine/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/standard-port public HTTPS/i);
    expect(saveEngine).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^local/i }));
    await user.clear(screen.getByLabelText(/default model/i));
    await user.type(screen.getByLabelText(/default model/i), 'local-model');
    await user.clear(screen.getByLabelText(/^base url$/i));
    await user.type(screen.getByLabelText(/^base url$/i), 'https://models.example/v1');
    await user.click(screen.getByRole('button', { name: /save engine/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/loopback HTTP\(S\)/i);
    expect(saveEngine).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/^base url$/i));
    fireEvent.change(screen.getByLabelText(/^base url$/i), {
      target: { value: 'http://[::1]:11434/v1///' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /save engine/i }).closest('form')!);

    await waitFor(() =>
      expect(saveEngine).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'local',
          provider: 'compatible',
          baseUrl: 'http://[::1]:11434/v1',
        })
      )
    );
  });

  it('stores an explicit compatible provider whenever a task mode changes', async () => {
    const user = userEvent.setup();
    render(<TaskMatrixSection workspaceId="workspace-1" engine={baseEngine} reload={vi.fn()} />);
    await user.selectOptions(screen.getAllByLabelText(/^mode$/i)[0]!, 'local');
    await user.click(screen.getByRole('button', { name: /save task settings/i }));

    await waitFor(() =>
      expect(savePrefs).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({ narration: { mode: 'local', provider: 'ollama' } })
      )
    );
  });
});
