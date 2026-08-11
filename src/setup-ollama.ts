import { err, ok, type Result } from "neverthrow";

// `rejudge setup ollama` (CLI-087) — turn what the local Ollama daemon reports into a Pi provider
// and a Rejudge panel. Everything here is pure: the daemon listing comes in as parsed JSON and the
// files to write come out as values, so the whole decision path is testable without a daemon or a
// filesystem. `cli.ts` owns the HTTP and the writes.

/**
 * One model exactly as the daemon reports it in `GET /api/tags`, reduced to what a config needs.
 *
 * `contextLength` is `details.context_length`, which the daemon omits for some local models — the
 * caller has to decide what to do about that rather than invent a window.
 */
export interface DaemonModel {
  /** The id to write in the config, e.g. `glm-5.2:cloud`. */
  id: string;
  /** The real context window, or `undefined` when the daemon does not report one. */
  contextLength?: number;
  /** Reports the `thinking` capability. Without it a model's `@level` silently becomes `off`. */
  thinking: boolean;
  /** Reports the `tools` capability. A reviewer that cannot call tools cannot read the diff. */
  tools: boolean;
}

/**
 * Read a `GET /api/tags` payload. Never throws: a shape we do not recognize yields no models, so a
 * daemon on a different version degrades into "nothing found" instead of a stack trace. Entries
 * without a usable name are dropped — there is nothing to write for them.
 */
export function parseDaemonModels(payload: unknown): DaemonModel[] {
  const models = (payload as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];

  const parsed: DaemonModel[] = [];
  for (const entry of models) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const id = typeof record.name === "string" ? record.name.trim() : "";
    if (id === "") continue;

    const details = (record.details ?? {}) as Record<string, unknown>;
    const contextLength = typeof details.context_length === "number" ? details.context_length : undefined;
    const capabilities = Array.isArray(record.capabilities) ? record.capabilities : [];

    parsed.push({
      id,
      contextLength,
      thinking: capabilities.includes("thinking"),
      tools: capabilities.includes("tools"),
    });
  }

  return parsed;
}

/** Why a model cannot serve in a panel. Each one is something that breaks a review quietly. */
export type IneligibleReason = "no-thinking" | "no-tools" | "no-context";

/**
 * Whether a model can serve as a reviewer or judge, and if not, why. This is about silent breakage,
 * not model quality:
 *
 * - `no-thinking` — Rejudge requires an `@level` per model, and Pi clamps a level the model does not
 *   support, so a non-thinking model runs with reasoning off and nothing says so.
 * - `no-tools` — a reviewer's whole job is fetching the diff and reading around it.
 * - `no-context` — the daemon did not report a window. Writing a guess is the one mistake that turns
 *   a truncated review into a confident-looking success, so the model is reported instead.
 */
export function ineligibleReason(model: DaemonModel): IneligibleReason | undefined {
  if (!model.thinking) return "no-thinking";
  if (!model.tools) return "no-tools";
  if (model.contextLength === undefined) return "no-context";
  return undefined;
}

/** Every Rejudge level mapped onto the vocabulary Ollama accepts: `high|medium|low|max|none`. */
const THINKING_LEVEL_MAP = {
  off: "none",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
  max: "max",
} as const;

/**
 * Upper bound for a model's output cap. Reasoning counts against it, so it is generous; a cap that
 * is too low fails loudly (`stopReason: "length"`), which is why erring high is the safe direction.
 */
const MAX_OUTPUT_TOKENS = 32768;

/** One entry in the provider's `models` array, in the shape Pi's `models.json` expects. */
export interface ProviderModel {
  id: string;
  reasoning: true;
  thinkingLevelMap: typeof THINKING_LEVEL_MAP;
  input: ["text"];
  cost: { input: 0; output: 0; cacheRead: 0; cacheWrite: 0 };
  contextWindow: number;
  maxTokens: number;
}

/** The `providers.ollama` block, ready to merge into `models.json`. */
export interface OllamaProvider {
  name: string;
  baseUrl: string;
  api: "openai-completions";
  apiKey: string;
  compat: { supportsDeveloperRole: false; maxTokensField: "max_tokens" };
  models: ProviderModel[];
}

/**
 * Build the provider block from a daemon listing, declaring only the models that can serve a review
 * (see {@link ineligibleReason}) — the rest are the caller's to report, never written into a config
 * that fails at review time.
 *
 * Two `compat` fields are not optional. Pi assumes OpenAI's behavior for a base URL it does not
 * recognize, and both assumptions are wrong for Ollama without producing an error: the system prompt
 * would go out as `role: "developer"`, which Ollama passes into a chat template that does not handle
 * it, so the reviewer never sees its instructions; and the output cap would ride on
 * `max_completion_tokens`, which Ollama accepts and ignores.
 *
 * `apiKey` is a placeholder because the daemon holds the credentials — but it cannot be empty, or
 * the provider fails validation and every model reads as unknown.
 */
export function buildOllamaProvider(models: DaemonModel[]): OllamaProvider {
  const eligible = models.filter((model) => ineligibleReason(model) === undefined);

  return {
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    api: "openai-completions",
    apiKey: "ollama",
    compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
    models: eligible.map((model) => {
      const contextWindow = model.contextLength as number;
      return {
        id: model.id,
        reasoning: true,
        thinkingLevelMap: THINKING_LEVEL_MAP,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens: Math.min(MAX_OUTPUT_TOKENS, contextWindow),
      };
    }),
  };
}

/**
 * The lab a model comes from, used to keep a proposed panel diverse: models that share weights
 * share their blind spots, so a panel that agrees for that reason says nothing.
 *
 * The heuristic is the model name's leading letters — `glm-5.2:cloud` and `glm-5.1:cloud` are both
 * `glm`, `kimi-k2.6:cloud` and `kimi-k2.7-code:cloud` are both `kimi`. It is deliberately crude:
 * this only orders a proposal the user is free to edit, so a wrong grouping costs a suggestion, not
 * a run. A name that starts with no letters falls back to the whole id, so it never groups with
 * anything by accident.
 */
export function modelFamily(id: string): string {
  const leading = /^[a-z]+/i.exec(id.split(":")[0]);
  return leading ? leading[0].toLowerCase() : id;
}

/**
 * Whether an id addresses a cloud model the daemon proxies, rather than weights on this machine.
 *
 * The difference is not cosmetic. For a cloud model the reported context window is what the service
 * serves. For a local one it is the model's maximum, while the daemon serves whatever
 * `OLLAMA_CONTEXT_LENGTH` was set to — and on overflow Ollama truncates the input silently, which
 * Rejudge cannot detect: the run ends cleanly with text, so a review of a diff the model never saw
 * is reported as a success. So a cloud model's declared window can be trusted and a local one's
 * cannot, which is why panel slots prefer cloud.
 */
export function isCloudProxy(id: string): boolean {
  return id.endsWith(":cloud") || id.endsWith("-cloud");
}

/** A suggested panel. `diverse` is false when a slot had to reuse a family already in the panel. */
export interface PanelProposal {
  reviewers: string[];
  judge: string;
  /** True when every slot came from a different family — the point of running a panel at all. */
  diverse: boolean;
}

/**
 * Suggest a panel from a daemon listing. A suggestion, not a decision: the user edits the config
 * afterwards, so this only has to be defensible and repeatable.
 *
 * The judge takes the widest context window, because it is the one agent whose context accumulates
 * everything — every reviewer's analysis, plus whatever `ask_panel` brings back. Reviewers then take
 * the widest remaining models from families the panel has not used yet, because two models from one
 * lab share their blind spots and a panel that agrees for that reason has told you nothing. Ordering
 * breaks ties on the id so the same listing always yields the same panel.
 *
 * When the families run out the slots are filled anyway and `diverse` comes back false — a panel the
 * caller can report honestly beats refusing to suggest one.
 */
export function proposePanel(models: DaemonModel[], reviewerCount = 3): Result<PanelProposal, string> {
  const eligible = models.filter((model) => ineligibleReason(model) === undefined);
  const needed = reviewerCount + 1;
  if (eligible.length < needed) {
    return err(
      `a panel needs ${needed} eligible models (${reviewerCount} reviewers plus a judge); found ${eligible.length}`,
    );
  }

  // Cloud first, because only a cloud model's declared context window is the one actually served
  // (see {@link isCloudProxy}); then the widest window; then the id, so the order is total and the
  // same listing always yields the same panel.
  const ranked = [...eligible].sort(
    (a, b) =>
      Number(isCloudProxy(b.id)) - Number(isCloudProxy(a.id)) ||
      (b.contextLength as number) - (a.contextLength as number) ||
      a.id.localeCompare(b.id),
  );

  const judge = ranked[0];
  const usedFamilies = new Set([modelFamily(judge.id)]);
  const rest = ranked.slice(1);

  // First pass takes only unused families; a second pass fills whatever is left, so a listing
  // dominated by one lab still yields a panel — flagged as not diverse.
  const reviewers: DaemonModel[] = [];
  for (const model of rest) {
    if (reviewers.length === reviewerCount) break;
    const family = modelFamily(model.id);
    if (usedFamilies.has(family)) continue;
    usedFamilies.add(family);
    reviewers.push(model);
  }
  for (const model of rest) {
    if (reviewers.length === reviewerCount) break;
    if (reviewers.includes(model)) continue;
    reviewers.push(model);
  }

  const families = new Set([judge, ...reviewers].map((model) => modelFamily(model.id)));

  return ok({
    reviewers: reviewers.map((model) => model.id),
    judge: judge.id,
    diverse: families.size === reviewers.length + 1,
  });
}

/** A `models.json` document. Only `providers` is ours to touch; everything else is the user's. */
export interface ModelsJson {
  providers: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Put the provider into a `models.json` document, preserving everything else in the file — other
 * providers, their credentials and headers, and unrelated top-level settings. That file is the top
 * user-config layer over Pi's built-in providers, so replacing it wholesale would silently drop
 * settings that have nothing to do with Ollama.
 *
 * The `ollama` provider itself is replaced rather than deep-merged: it is generated in full, and a
 * merge would leave stale models from an earlier run in place. A file whose root is not an object is
 * unusable to Pi anyway, so it is replaced.
 */
export function mergeProviderInto(existing: unknown, provider: OllamaProvider): ModelsJson {
  const root = typeof existing === "object" && existing !== null && !Array.isArray(existing)
    ? (existing as Record<string, unknown>)
    : {};

  const providers = typeof root.providers === "object" && root.providers !== null && !Array.isArray(root.providers)
    ? (root.providers as Record<string, unknown>)
    : {};

  return { ...root, providers: { ...providers, ollama: provider } };
}
