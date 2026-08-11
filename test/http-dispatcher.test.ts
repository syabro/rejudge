import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { configureHttpDispatcher } from "../src/http-dispatcher.ts";

// configureHttpDispatcher replaces process-wide state — the dispatcher and, through install(),
// fetch. Snapshot both so a worker running other files after this one stays clean.
const originalDispatcher = getGlobalDispatcher();
const originalFetch = globalThis.fetch;

// Every spelling, not only the ones a test writes today, so a test that throws before its own
// cleanup cannot leak a proxy setting into the rest of the worker.
const PROXY_VARS = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "no_proxy", "NO_PROXY"];
const originalProxyEnv = new Map(PROXY_VARS.map((name) => [name, process.env[name]]));

const running: Server[] = [];

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
  globalThis.fetch = originalFetch;

  for (const [name, value] of originalProxyEnv) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  while (running.length > 0) {
    running.pop()?.close();
  }
});

async function listen(server: Server): Promise<number> {
  running.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

/** The service a review would be talking to. */
async function startOrigin(): Promise<number> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("from origin");
  });

  return listen(server);
}

/**
 * A stand-in corporate proxy. Undici tunnels rather than forwarding absolute-form requests, so the
 * interesting event is CONNECT: it records the authority it was asked to reach and then pipes the
 * bytes through, which is what proves traffic went this way instead of direct.
 */
async function startProxy(): Promise<{ url: string; tunneled: string[] }> {
  const tunneled: string[] = [];
  const server = createServer();

  server.on("connect", (req, clientSocket, head) => {
    tunneled.push(req.url ?? "");

    const [host, port] = (req.url ?? "").split(":");
    const upstream = connect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });

    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });

  return { url: `http://127.0.0.1:${await listen(server)}`, tunneled };
}

test("with no proxy in the environment a request still goes straight out", async () => {
  const origin = await startOrigin();

  configureHttpDispatcher({});

  const response = await fetch(`http://127.0.0.1:${origin}/models`);
  expect(await response.text()).toBe("from origin");
});

test("a request travels through the proxy the environment names", async () => {
  const origin = await startOrigin();
  const proxy = await startProxy();

  configureHttpDispatcher({ HTTP_PROXY: proxy.url });

  const response = await fetch(`http://127.0.0.1:${origin}/models`);

  expect(await response.text()).toBe("from origin");
  expect(proxy.tunneled).toEqual([`127.0.0.1:${origin}`]);
});

test("NO_PROXY keeps a listed host off the proxy", async () => {
  const origin = await startOrigin();
  const proxy = await startProxy();

  configureHttpDispatcher({ HTTP_PROXY: proxy.url, NO_PROXY: "127.0.0.1" });

  const response = await fetch(`http://127.0.0.1:${origin}/models`);

  expect(await response.text()).toBe("from origin");
  expect(proxy.tunneled).toEqual([]);
});

test("the caller's environment decides, whatever the process environment says", async () => {
  const origin = await startOrigin();
  const proxy = await startProxy();

  // Both would send this request somewhere else if they leaked in: an unreachable proxy, and a
  // no-proxy list covering the origin.
  process.env.HTTP_PROXY = "http://127.0.0.1:1";
  process.env.NO_PROXY = "127.0.0.1";

  configureHttpDispatcher({ HTTP_PROXY: proxy.url });
  await fetch(`http://127.0.0.1:${origin}/models`);

  expect(proxy.tunneled).toEqual([`127.0.0.1:${origin}`]);
});

test("lowercase wins when both spellings are set, as undici resolves them", async () => {
  const origin = await startOrigin();
  const chosen = await startProxy();
  const ignored = await startProxy();

  configureHttpDispatcher({ http_proxy: chosen.url, HTTP_PROXY: ignored.url });
  await fetch(`http://127.0.0.1:${origin}/models`);

  expect(chosen.tunneled).toEqual([`127.0.0.1:${origin}`]);
  expect(ignored.tunneled).toEqual([]);
});

// Names what it asserts: a severed tunnel rejects. It cannot prove the error listener on its own —
// fetch rejects either way — but it does drive the path that emits the "error" event, so removing
// silenceStreamAborts takes the worker down here rather than in front of a user.
test("a tunnel dropped under a request rejects", async () => {
  // Opens the tunnel, waits for the request to go out, then cuts the socket. That makes undici's
  // Client emit "error" with a request in flight — the event that ends the process when unheard.
  const server = createServer();
  server.on("connect", (_req, clientSocket) => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    clientSocket.once("data", () => clientSocket.destroy());
  });
  const port = await listen(server);

  configureHttpDispatcher({ HTTP_PROXY: `http://127.0.0.1:${port}` });

  await expect(fetch("http://127.0.0.1:1/models")).rejects.toThrow();
});
