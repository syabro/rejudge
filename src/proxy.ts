import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

export function configureProxyFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const proxyUrl =
    env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (!proxyUrl) return false;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  return true;
}
