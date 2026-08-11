import { test, expect } from "vitest";
import {
  buildOllamaProvider,
  ineligibleReason,
  isCloudProxy,
  mergeProviderInto,
  modelFamily,
  parseDaemonModels,
  proposePanel,
  type DaemonModel,
} from "../src/setup-ollama.ts";

function daemonModel(over: Partial<DaemonModel> = {}): DaemonModel {
  return { id: "glm-5.2:cloud", contextLength: 1000000, thinking: true, tools: true, ...over };
}

// Real `GET /api/tags` shape, trimmed to the fields the setup reads. Recorded from a live daemon:
// a cloud proxy with a context length, a local model that reports none, and a tools-only model.
const TAGS = {
  models: [
    {
      name: "glm-5.2:cloud",
      details: { context_length: 1000000 },
      capabilities: ["completion", "tools", "thinking"],
    },
    {
      name: "gpt-oss:120b-cloud",
      details: { context_length: 131072 },
      capabilities: ["completion", "tools", "thinking"],
    },
    {
      name: "qwen3-coder:480b-cloud",
      details: { context_length: 262144 },
      capabilities: ["completion", "tools"],
    },
    {
      name: "gemma4:latest",
      details: {},
      capabilities: ["completion", "tools", "thinking"],
    },
  ],
};

test("parses each model's id, context length, and the two capabilities that matter", () => {
  expect(parseDaemonModels(TAGS)).toEqual([
    { id: "glm-5.2:cloud", contextLength: 1000000, thinking: true, tools: true },
    { id: "gpt-oss:120b-cloud", contextLength: 131072, thinking: true, tools: true },
    { id: "qwen3-coder:480b-cloud", contextLength: 262144, thinking: false, tools: true },
    { id: "gemma4:latest", contextLength: undefined, thinking: true, tools: true },
  ]);
});

test("a payload without a models array yields no models instead of throwing", () => {
  expect(parseDaemonModels({})).toEqual([]);
  expect(parseDaemonModels(null)).toEqual([]);
  expect(parseDaemonModels({ models: "nope" })).toEqual([]);
});

test("entries without a usable name are dropped", () => {
  expect(parseDaemonModels({ models: [{ name: "" }, { name: 7 }, {}, { name: "glm-5.2:cloud" }] })).toEqual([
    { id: "glm-5.2:cloud", contextLength: undefined, thinking: false, tools: false },
  ]);
});

// The family is what makes a panel diverse: two models from the same lab share their blind spots,
// so the proposal spends one slot per family. The leading letters are the whole heuristic.
test("the family is the model name's leading letters, so one lab's models group together", () => {
  expect(modelFamily("glm-5.2:cloud")).toBe("glm");
  expect(modelFamily("glm-5.1:cloud")).toBe("glm");
  expect(modelFamily("deepseek-v4-pro:cloud")).toBe("deepseek");
  expect(modelFamily("deepseek-v4-flash:0731-cloud")).toBe("deepseek");
  expect(modelFamily("kimi-k2.6:cloud")).toBe("kimi");
  expect(modelFamily("kimi-k2.7-code:cloud")).toBe("kimi");
  expect(modelFamily("minimax-m3:cloud")).toBe("minimax");
  expect(modelFamily("nemotron-3-super:cloud")).toBe("nemotron");
  expect(modelFamily("gemma4:31b-cloud")).toBe("gemma");
  expect(modelFamily("qwen3.5:397b-cloud")).toBe("qwen");
  expect(modelFamily("gpt-oss:120b-cloud")).toBe("gpt");
});

test("a name with no leading letters falls back to the id, so it never groups by accident", () => {
  expect(modelFamily("7b:cloud")).toBe("7b:cloud");
});

// Eligibility is about what silently breaks a review, not about model quality.
test("a model that reports thinking, tools, and a context window is eligible", () => {
  expect(ineligibleReason(daemonModel())).toBeUndefined();
});

test("no thinking is a rejection, because the required @level would silently become off", () => {
  expect(ineligibleReason(daemonModel({ thinking: false }))).toBe("no-thinking");
});

test("no tools is a rejection, because a reviewer has to read the diff", () => {
  expect(ineligibleReason(daemonModel({ tools: false }))).toBe("no-tools");
});

test("an unreported context window is a rejection rather than a guessed number", () => {
  expect(ineligibleReason(daemonModel({ contextLength: undefined }))).toBe("no-context");
});

test("the provider carries the two compat fields Pi gets wrong for Ollama, and the placeholder key", () => {
  const provider = buildOllamaProvider([daemonModel()]);

  expect(provider.baseUrl).toBe("http://127.0.0.1:11434/v1");
  expect(provider.api).toBe("openai-completions");
  expect(provider.apiKey).toBe("ollama");
  expect(provider.compat).toEqual({ supportsDeveloperRole: false, maxTokensField: "max_tokens" });
});

test("each declared model maps every Rejudge level onto Ollama's vocabulary", () => {
  const [model] = buildOllamaProvider([daemonModel()]).models;

  expect(model.reasoning).toBe(true);
  expect(model.thinkingLevelMap).toEqual({
    off: "none",
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "max",
    max: "max",
  });
});

test("the declared context window is the daemon's number, and the output cap never exceeds it", () => {
  const [wide] = buildOllamaProvider([daemonModel({ contextLength: 1000000 })]).models;
  expect(wide.contextWindow).toBe(1000000);
  expect(wide.maxTokens).toBe(32768);

  const [narrow] = buildOllamaProvider([daemonModel({ contextLength: 8192 })]).models;
  expect(narrow.contextWindow).toBe(8192);
  expect(narrow.maxTokens).toBe(8192);
});

test("ineligible models are left out of the provider instead of written and failing later", () => {
  const provider = buildOllamaProvider([
    daemonModel({ id: "glm-5.2:cloud" }),
    daemonModel({ id: "qwen3-coder:480b-cloud", thinking: false }),
    daemonModel({ id: "gemma4:latest", contextLength: undefined }),
  ]);

  expect(provider.models.map((m) => m.id)).toEqual(["glm-5.2:cloud"]);
});

test("cost is present and zero, because a subscription has no per-token price", () => {
  const [model] = buildOllamaProvider([daemonModel()]).models;
  expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

// --- panel proposal ---------------------------------------------------------

const FOUR_LABS: DaemonModel[] = [
  daemonModel({ id: "glm-5.2:cloud", contextLength: 1000000 }),
  daemonModel({ id: "deepseek-v4-pro:cloud", contextLength: 524288 }),
  daemonModel({ id: "minimax-m3:cloud", contextLength: 524288 }),
  daemonModel({ id: "gemma4:31b-cloud", contextLength: 262144 }),
];

test("the judge takes the widest context, because it holds every analysis at once", () => {
  expect(proposePanel(FOUR_LABS)._unsafeUnwrap().judge).toBe("glm-5.2:cloud");
});

test("reviewers come from families the panel has not used yet", () => {
  const panel = proposePanel(FOUR_LABS)._unsafeUnwrap();

  expect(panel.reviewers).toEqual(["deepseek-v4-pro:cloud", "minimax-m3:cloud", "gemma4:31b-cloud"]);
  expect(panel.diverse).toBe(true);
});

test("ties break on the id, so the same listing always proposes the same panel", () => {
  const shuffled = [...FOUR_LABS].reverse();
  expect(proposePanel(shuffled)._unsafeUnwrap()).toEqual(proposePanel(FOUR_LABS)._unsafeUnwrap());
});

test("one lab cannot fill the panel alone without saying so", () => {
  const oneLab = [
    daemonModel({ id: "glm-5.2:cloud", contextLength: 1000000 }),
    daemonModel({ id: "glm-5.1:cloud", contextLength: 202752 }),
    daemonModel({ id: "glm-4.9:cloud", contextLength: 202752 }),
    daemonModel({ id: "glm-4.8:cloud", contextLength: 202752 }),
  ];
  const panel = proposePanel(oneLab)._unsafeUnwrap();

  expect(panel.reviewers).toHaveLength(3);
  expect(panel.diverse).toBe(false);
});

test("ineligible models never reach a panel slot", () => {
  const withJunk = [...FOUR_LABS, daemonModel({ id: "qwen3-coder:480b-cloud", thinking: false })];
  const panel = proposePanel(withJunk)._unsafeUnwrap();

  expect([...panel.reviewers, panel.judge]).not.toContain("qwen3-coder:480b-cloud");
});

test("too few eligible models is a failure that says how many were found", () => {
  const result = proposePanel(FOUR_LABS.slice(0, 3));

  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr()).toMatch(/needs 4.*found 3/);
});

// --- merging into an existing models.json -----------------------------------

test("an absent file produces a file with just this provider", () => {
  const merged = mergeProviderInto(undefined, buildOllamaProvider([daemonModel()]));
  expect(Object.keys(merged.providers)).toEqual(["ollama"]);
});

test("other providers, their keys, and unrelated top-level settings all survive", () => {
  const existing = {
    providers: {
      "opencode-go": { apiKey: "$OPENCODE_API_KEY", headers: { "X-Trace": "1" } },
    },
    modelOverrides: { "anthropic/claude": { contextWindow: 1 } },
  };
  const merged = mergeProviderInto(existing, buildOllamaProvider([daemonModel()]));

  expect(merged.providers["opencode-go"]).toEqual(existing.providers["opencode-go"]);
  expect(merged.modelOverrides).toEqual(existing.modelOverrides);
  expect(Object.keys(merged.providers).sort()).toEqual(["ollama", "opencode-go"]);
});

test("an existing ollama provider is replaced, not deep-merged into a stale hybrid", () => {
  const existing = { providers: { ollama: { baseUrl: "http://elsewhere:1234/v1", models: [{ id: "gone" }] } } };
  const merged = mergeProviderInto(existing, buildOllamaProvider([daemonModel()]));

  expect(merged.providers.ollama).toEqual(buildOllamaProvider([daemonModel()]));
});

test("a file whose root is not an object is replaced rather than merged into", () => {
  const merged = mergeProviderInto([1, 2, 3], buildOllamaProvider([daemonModel()]));
  expect(Object.keys(merged.providers)).toEqual(["ollama"]);
});

// --- local models carry a risk cloud proxies do not -------------------------
// A cloud model's reported window is what the service serves. A local model's is the model's
// maximum, while the daemon serves whatever OLLAMA_CONTEXT_LENGTH says — and on overflow Ollama
// truncates the input silently, which Rejudge cannot detect and reports as a successful review.

test("a cloud proxy is recognised by its suffix, in both spellings", () => {
  expect(isCloudProxy("glm-5.2:cloud")).toBe(true);
  expect(isCloudProxy("gpt-oss:120b-cloud")).toBe(true);
  expect(isCloudProxy("gemma4:latest")).toBe(false);
  expect(isCloudProxy("gemma4:26b-a4b-it-qat")).toBe(false);
  expect(isCloudProxy("gemma4")).toBe(false);
});

test("a local model does not take a panel slot away from a cloud one", () => {
  const mixed: DaemonModel[] = [
    daemonModel({ id: "local-thing:26b", contextLength: 1000000 }),
    daemonModel({ id: "glm-5.2:cloud", contextLength: 202752 }),
    daemonModel({ id: "deepseek-v4-pro:cloud", contextLength: 202752 }),
    daemonModel({ id: "minimax-m3:cloud", contextLength: 202752 }),
    daemonModel({ id: "gemma4:31b-cloud", contextLength: 202752 }),
  ];
  const panel = proposePanel(mixed)._unsafeUnwrap();

  expect([...panel.reviewers, panel.judge]).not.toContain("local-thing:26b");
});

test("a local model is still used when there are not enough cloud ones", () => {
  const mixed: DaemonModel[] = [
    daemonModel({ id: "glm-5.2:cloud", contextLength: 1000000 }),
    daemonModel({ id: "deepseek-v4-pro:cloud", contextLength: 524288 }),
    daemonModel({ id: "minimax-m3:cloud", contextLength: 524288 }),
    daemonModel({ id: "local-thing:26b", contextLength: 262144 }),
  ];
  const panel = proposePanel(mixed)._unsafeUnwrap();

  expect(panel.reviewers).toContain("local-thing:26b");
});
