// Synthetic connector fixtures. docs/ARCHITECTURE.md requires every publicly
// supported connector to prove its behavior against the same set of provider
// responses before it stops being "coming soon". Fixtures are typed literals
// rather than JSON on disk so the Deno mirror can import them without a
// filesystem read, and so a missing scenario is a type error instead of a
// forgotten file. Every value here is invented; never paste a production or
// customer capture into this directory.

export const CONNECTOR_FIXTURE_SCENARIOS = [
  'success',
  'sampled',
  'malformed',
  'timeout',
  'rate_limit',
  'revoked_credentials',
  'redaction',
] as const;

export type ConnectorFixtureScenario = (typeof CONNECTOR_FIXTURE_SCENARIOS)[number];

/** One provider reply, or a provider that accepts the request and never
 * answers. `timeout` is a distinct outcome because a hung connection is the
 * failure a status code cannot express. */
export type ConnectorFixtureExchange =
  | { outcome: 'response'; status: number; headers?: Record<string, string>; body: unknown }
  | { outcome: 'timeout' };

export interface ConnectorFixture {
  scenario: ConnectorFixtureScenario;
  /** What the run must do with these exchanges, in reviewer-readable terms. */
  expectation: string;
  exchanges: ConnectorFixtureExchange[];
}

/** A fixture set is complete only when every scenario is present, so each
 * connector declares this exact map. */
export type ConnectorFixtures = Record<ConnectorFixtureScenario, ConnectorFixture>;
