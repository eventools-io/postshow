// There is no published `postshow` binary yet, so every command shown in the
// app runs the built entry point from a source checkout. SOURCE_CLI_INSTALL
// clones into ~/postshow and SOURCE_CLI_COMMAND runs that exact checkout; a
// clone anywhere else needs the same substitution in every command.

export const SOURCE_CLI_INSTALL = `git clone https://github.com/eventools-io/postshow.git ~/postshow
cd ~/postshow && pnpm install && pnpm --filter postshow build`;

export const SOURCE_CLI_COMMAND = 'node ~/postshow/packages/postshow-cli/dist/index.js';

export const SOURCE_CLI_GUIDE =
  'https://github.com/eventools-io/postshow/blob/main/packages/postshow-cli/README.md#setup';

/** The exact value `postshow init` asks for. The CLI appends the gateway path
 * itself, so only the origin belongs here. An empty string means this
 * deployment has no configured origin and the CLI cannot be bound to it. */
export function workspaceApiUrl(): string {
  const raw = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}
