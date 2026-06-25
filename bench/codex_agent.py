"""Codex baseline agent for the Pi-vs-codex comparison (BENCH-037).

The benchmark sandboxes lock the network to an allowlist (squid egress proxy).
pier's built-in Codex allows only `api.openai.com` by default, which is the
API-key path. When codex authenticates with a ChatGPT login instead
(`CODEX_FORCE_AUTH_JSON=1`, uploading the host's ~/.codex/auth.json), its model
calls go to `chatgpt.com/backend-api` — a host the default allowlist blocks.

This subclass changes nothing else: it only widens the allowlist so the
ChatGPT-login flow can reach the model (and refresh a token via auth.openai.com
if one ever expires mid-run). Everything else — install, run, ATIF trajectory —
is the upstream Codex agent.

Run via bench/run.sh with `--agent-import-path codex_agent:CodexChatGPT`,
loaded from this repo through PYTHONPATH=bench (no pier fork).
"""

from pier.agents.installed.codex import Codex
from pier.models.agent.network import NetworkAllowlist

# Hosts a ChatGPT-login codex needs beyond the upstream api.openai.com default:
# the ChatGPT backend that serves model calls, and the OAuth host for token refresh.
_CHATGPT_DOMAINS = ("chatgpt.com", "auth.openai.com")


class CodexChatGPT(Codex):
    """Upstream Codex with the ChatGPT-login hosts added to the egress allowlist."""

    def network_allowlist(self) -> NetworkAllowlist:
        base = super().network_allowlist()
        domains = set(base.domains) | set(_CHATGPT_DOMAINS)
        return NetworkAllowlist(domains=sorted(domains))
