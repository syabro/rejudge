import { test } from "vitest";

/**
 * Gate for integration tests — those that make a real reviewer/judge call on a
 * stub model) and therefore need credentials. Deterministic tests use plain `test` and run
 * anywhere; integration tests use {@link integrationTest} so a contributor without a key
 * still gets a green deterministic suite (the gated tests show as skipped, never failed).
 *
 * Signals:
 * - `OPENCODE_API_KEY` set → run (the usual CI/local path).
 * - `PI_TEST_INTEGRATION=1` → run even without the env key (e.g. when Pi auth comes from
 *   `pi login` stored credentials rather than an exported variable).
 * - `PI_TEST_UNIT_ONLY=1` → force-skip integration even when a key is present (the fast
 *   deterministic-only run, e.g. `npm run test:unit`).
 */
const hasApiKey = Boolean(process.env.OPENCODE_API_KEY?.trim());
const forceIntegration = process.env.PI_TEST_INTEGRATION === "1";
const unitOnly = process.env.PI_TEST_UNIT_ONLY === "1";

export const runIntegration = !unitOnly && (hasApiKey || forceIntegration);

/** A test that needs a real model. Runs only when {@link runIntegration}; otherwise skipped. */
export const integrationTest = runIntegration ? test : test.skip;
