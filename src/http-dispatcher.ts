import { EventEmitter } from "node:events";
// Namespace import, like Pi's own setup: undici ships CommonJS, and `install` is not visible as a
// named ESM export, so importing it by name fails at load time.
import * as undici from "undici";

/**
 * Mirrors pi-coding-agent 0.83.0 `dist/core/http-dispatcher.ts`, which is not reachable from here:
 * the package publishes only `.` and `./rpc-entry`, so a deep import is blocked. Re-check these
 * options when Pi is upgraded — nothing fails loudly if they drift.
 */
const IDLE_TIMEOUT_MS = 300_000;

/**
 * Give this process the HTTP stack Pi gives its own, and route provider calls through whatever
 * proxy the environment names.
 *
 * Pi does this at its startup, but that runs from Pi's entry point — the standalone CLI builds its
 * process itself, so without this call nothing is configured. Two consequences, and only the first
 * one is about proxies:
 *
 * - Behind a corporate proxy every request went direct, which fails far from its cause: in a
 *   geo-restricted region the refused direct connection surfaces as a provider 403.
 * - No listener guarded the "error" undici emits when a fetch body is torn down mid-stream, which
 *   this panel does on every run — the first reviewer failure aborts its siblings.
 *
 * So this is called unconditionally, exactly as Pi calls it. With no proxy in the environment the
 * agent simply has nothing to route through.
 *
 * Undici keeps the global dispatcher on a `Symbol.for` key shared across copies, and
 * `setGlobalDispatcher` overwrites unconditionally, so this replaces the direct-connection default
 * undici installs when its own module loads — the order of imports does not matter.
 */
export function configureHttpDispatcher(env: NodeJS.ProcessEnv = process.env): void {
  undici.setGlobalDispatcher(
    silenceStreamAborts(
      new undici.EnvHttpProxyAgent({
        // Every value is passed, including the empty ones: an option left out is one undici reads
        // from the ambient process environment instead, which would ignore the caller's `env`.
        // Lowercase first is undici's own resolution order, and shows when both spellings are set
        // to different values — which a shell or CI wrapper can do on a case-sensitive system.
        httpProxy: env.http_proxy ?? env.HTTP_PROXY ?? "",
        httpsProxy: env.https_proxy ?? env.HTTPS_PROXY ?? "",
        noProxy: env.no_proxy ?? env.NO_PROXY ?? "",
        allowH2: false,
        bodyTimeout: IDLE_TIMEOUT_MS,
        headersTimeout: IDLE_TIMEOUT_MS,
        clientFactory: createClient,
        factory: createOriginDispatcher,
      }),
    ),
  );

  // Keep fetch and the dispatcher on one undici copy. Node 26's bundled fetch otherwise reads a
  // compressed response through this dispatcher without decompressing it, and `.json()` fails.
  // Optional because a runtime may ship undici without it; then only that fix is absent.
  undici.install?.();
}

/**
 * EventEmitter treats an unheard "error" as fatal, so a connection dropped mid-stream would take
 * the whole process down. The body still rejects through its reader, so swallowing the event here
 * loses nothing a caller could have acted on.
 */
function silenceStreamAborts<T extends undici.Dispatcher>(dispatcher: T): T {
  EventEmitter.prototype.on.call(dispatcher, "error", () => {});
  return dispatcher;
}

/**
 * Every connection the agent opens gets that listener, and undici builds them through these. The
 * signatures are undici's own: a loose `object` for options it hands straight back, and an origin
 * that arrives as a string from `Agent` and as a URL from `ProxyAgent`.
 */
function createClient(origin: string | URL, options: object): undici.Dispatcher {
  return silenceStreamAborts(new undici.Client(origin, options));
}

function createOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  if ((options as undici.Pool.Options).connections === 1) {
    return createClient(origin, options);
  }
  return silenceStreamAborts(new undici.Pool(origin, { ...options, factory: createClient }));
}
