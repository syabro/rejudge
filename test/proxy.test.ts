import { test, expect } from "vitest";
import { getGlobalDispatcher, setGlobalDispatcher, Agent } from "undici";
import { configureProxyFromEnv } from "../src/proxy.ts";

function reset() {
  setGlobalDispatcher(new Agent());
}

test("no-op when no proxy env is set", () => {
  reset();
  const before = getGlobalDispatcher();
  expect(configureProxyFromEnv({})).toBe(false);
  expect(getGlobalDispatcher()).toBe(before);
});

test("installs EnvHttpProxyAgent when HTTPS_PROXY is set", () => {
  reset();
  expect(configureProxyFromEnv({ HTTPS_PROXY: "http://proxy.example:3128" })).toBe(true);
  expect(getGlobalDispatcher().constructor.name).toBe("EnvHttpProxyAgent");
});

test("honors lowercase https_proxy", () => {
  reset();
  expect(configureProxyFromEnv({ https_proxy: "http://proxy.example:3128" })).toBe(true);
  expect(getGlobalDispatcher().constructor.name).toBe("EnvHttpProxyAgent");
});

test("HTTP_PROXY alone triggers install", () => {
  reset();
  expect(configureProxyFromEnv({ HTTP_PROXY: "http://proxy.example:3128" })).toBe(true);
});

test("HTTPS_PROXY takes precedence over HTTP_PROXY", () => {
  reset();
  expect(
    configureProxyFromEnv({
      HTTPS_PROXY: "http://tls-proxy:3128",
      HTTP_PROXY: "http://plain-proxy:3128",
    }),
  ).toBe(true);
});
