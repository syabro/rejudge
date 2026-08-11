# Running behind a proxy

The `rejudge` command sends every provider call through the proxy your environment names. Set one
variable and nothing else changes:

```bash
export HTTPS_PROXY=http://proxy.example:3128
rejudge "does this migration need a lock?"
```

`HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` are all read, in either case — `https_proxy` works the
same as `HTTPS_PROXY`. With both spellings set to different values the lowercase one wins, which is
the order undici itself resolves them in. With no proxy variable set, nothing is configured and
requests go out exactly as before.

`NO_PROXY` takes the hosts that should stay direct, comma-separated:

```bash
export HTTPS_PROXY=http://proxy.example:3128
export NO_PROXY=localhost,127.0.0.1,.internal.example
```

## Inside Pi

Nothing to do — Pi configures its own proxy at startup, and the `rejudge` tool runs inside that
process. Pi also accepts a proxy in its settings file rather than the environment; the CLI does not
read that file, so a proxy configured only in Pi's settings applies only to Pi.

## Why the CLI needs its own setup

The CLI is a single bundled program with its own entry point. It uses Pi as a library but never runs
Pi's startup, so the code that installs a proxy-aware HTTP dispatcher never executed and every
request went direct. Behind a corporate proxy that fails far from its cause: in a geo-restricted
region the refused direct connection surfaces as a provider `403`, which reads like a credentials or
account problem rather than a network one.

`src/proxy.ts` does at CLI startup what Pi does at its own, with the same dispatcher options —
including the error listener that keeps a connection dropped mid-stream from taking the process
down, which matters here because the first reviewer failure aborts its siblings by design.

## What is not covered

- A proxy that requires authentication is untested. Undici reads credentials from the proxy URL
  (`http://user:pass@proxy:3128`), so it is expected to work, but nothing here proves it.
- The automated tests use plain HTTP origins. The HTTPS path — which is all real provider traffic —
  was verified by hand against a real proxy and a real TLS host, not in the suite.
- Only the CLI is covered. The Pi extension relies on Pi's own configuration.

## If it is not working

Point the variable at a proxy that logs, and watch for the provider host. A working setup shows a
`CONNECT` to the provider, since HTTPS traffic is tunneled rather than forwarded:

```
CONNECT opencode.ai:443
```

Seeing nothing there means the request went direct: check that the variable is exported in the same
shell that starts `rejudge`, and that `NO_PROXY` does not cover the provider.
