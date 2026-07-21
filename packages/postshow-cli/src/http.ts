// Node's fetch (undici) aborts any response whose headers take longer than
// 300s to arrive. A local model on modest hardware routinely takes longer
// than that to finish a non-streaming completion, so the local runtime would
// die mid-generation with a bare "fetch failed". Lift the header/body
// timeouts for this process; per-call deadlines stay the engine's job.
// Imported for its side effect by the CLI entry and the library surface the
// desktop app uses.

import { Agent, setGlobalDispatcher } from 'undici';

setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));
