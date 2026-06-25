"""A thin pier agent that runs the Pi coding CLI (BENCH-036/037).

Mirrors the built-in codex agent: install_spec provisions Node + Pi at build time,
run() executes `pi -p` on the task instruction inside the repo, then commits so the
harness's pre_artifacts.sh can capture `git diff base..HEAD`.

One harness (Pi), swappable model. Two provider paths:
  - opencode-go/<id>      → API key in OPENCODE_API_KEY, allowlist opencode.ai.
  - openai-codex/<id>     → the host's ChatGPT login (~/.pi/agent/auth.json) uploaded
                            into the sandbox via PI_CODING_AGENT_DIR; allowlist
                            chatgpt.com. Same gpt-5.5 the codex baseline uses, so a
                            Pi-vs-codex run isolates the harness.
Thinking level: pass it as a `:<level>` suffix on the model (e.g.
`openai-codex/gpt-5.5:xhigh`) or via the PI_THINKING agent env; it maps to `--thinking`.

Run via bench/run-pi.sh, which clones pier/deep-swe into bench/vendor/ (gitignored) and
invokes pier with PYTHONPATH=bench so this module loads from our repo, not pier's checkout.
"""

import shlex
from pathlib import Path

from pier.agents.installed.base import BaseInstalledAgent
from pier.agents.network import allowlist_from_urls
from pier.environments.base import BaseEnvironment
from pier.models.agent.context import AgentContext
from pier.models.agent.install import AgentInstallSpec, InstallStep
from pier.models.agent.network import NetworkAllowlist
from pier.models.trial.paths import EnvironmentPaths

# opencode-go provider base URL (Pi's OPENCODE_GO provider). The sandbox locks the
# network to an allowlist; this is the one host Pi must reach for the model call.
_OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1"

# Hosts the openai-codex provider (ChatGPT login) needs through the locked egress proxy:
# the ChatGPT backend that serves model calls, and the OAuth host for token refresh.
_CODEX_DOMAINS = ("chatgpt.com", "auth.openai.com")

# Where the ChatGPT-login auth lives on the host, and where we point Pi inside the sandbox.
_HOST_PI_AUTH = Path.home() / ".pi" / "agent" / "auth.json"
_REMOTE_PI_HOME = "/tmp/pi-home"

# Wall-clock cap for the Pi run itself, under the task's agent timeout.
_PI_TIMEOUT_SEC = 1800


class PiAgent(BaseInstalledAgent):
    """Runs the Pi CLI (`@earendil-works/pi-coding-agent`) as a pier agent."""

    SUPPORTS_ATIF = False

    @staticmethod
    def name() -> str:
        return "pi"

    def get_version_command(self) -> str | None:
        return 'if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi; pi --version'

    def _is_codex(self) -> bool:
        return (self.model_name or "").startswith("openai-codex")

    def _model_and_thinking(self) -> tuple[str, str | None]:
        """Split a `provider/id[:thinking]` model into (model, thinking). PI_THINKING wins."""
        raw = self.model_name or ""
        thinking = self._get_env("PI_THINKING")
        model = raw
        last = raw.rsplit("/", 1)[-1]
        if ":" in last:
            base, level = last.rsplit(":", 1)
            model = raw[: len(raw) - len(last)] + base
            thinking = thinking or level
        return model, thinking

    def network_allowlist(self) -> NetworkAllowlist:
        if self._is_codex():
            return NetworkAllowlist(domains=sorted(_CODEX_DOMAINS))
        urls = [_OPENCODE_BASE_URL]
        if base := self._get_env("OPENCODE_BASE_URL"):
            urls.append(base)
        return allowlist_from_urls(urls, default_domains=["opencode.ai"])

    def install_spec(self) -> AgentInstallSpec:
        version_spec = f"@{self._version}" if self._version else "@latest"

        root_run = (
            "if command -v apt-get >/dev/null 2>&1; then"
            "  apt-get update && apt-get install -y curl ca-certificates git;"
            " elif command -v apk >/dev/null 2>&1; then"
            "  apk add --no-cache curl bash git ca-certificates;"
            " elif command -v yum >/dev/null 2>&1; then"
            "  yum install -y curl git ca-certificates;"
            " fi"
        )

        # Install Node 24 via NVM as the agent user (Node 24 honors NODE_USE_ENV_PROXY,
        # so Pi's fetch routes the model call through the sandbox egress proxy), then Pi.
        agent_run = (
            "set -euo pipefail; "
            "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash && "
            'export NVM_DIR="$HOME/.nvm" && '
            '\\. "$NVM_DIR/nvm.sh" && '
            "nvm install 24 && nvm alias default 24 && npm -v && "
            f"npm install -g --ignore-scripts @earendil-works/pi-coding-agent{version_spec} && "
            "pi --version"
        )

        symlink_run = (
            "for bin in node pi; do"
            '  BIN_PATH="$(su - "$(id -un 1000 2>/dev/null || echo agent)" -c "'
            'if [ -s \\$HOME/.nvm/nvm.sh ]; then . \\$HOME/.nvm/nvm.sh; fi; which $bin" 2>/dev/null || true)";'
            '  if [ -n "$BIN_PATH" ] && [ "$BIN_PATH" != "/usr/local/bin/$bin" ]; then'
            '    ln -sf "$BIN_PATH" "/usr/local/bin/$bin";'
            "  fi;"
            " done"
        )

        return AgentInstallSpec(
            agent_name=self.name(),
            version=self._version,
            steps=[
                InstallStep(user="root", env={"DEBIAN_FRONTEND": "noninteractive"}, run=root_run),
                InstallStep(user="agent", run=agent_run),
                InstallStep(user="root", run=symlink_run),
            ],
        )

    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        if not self.model_name:
            raise ValueError("Model name is required (pass --model provider/<id>[:thinking])")

        model, thinking = self._model_and_thinking()
        agent_dir = EnvironmentPaths.agent_dir.as_posix()
        escaped = shlex.quote(instruction)

        # NODE_USE_ENV_PROXY makes Node 24's fetch honor HTTP(S)_PROXY (the sandbox proxy).
        # build_process_env folds in --ae vars.
        env = self.build_process_env({"NODE_USE_ENV_PROXY": "1"})

        if self._is_codex():
            # Upload the host's ChatGPT login and point Pi at it via PI_CODING_AGENT_DIR.
            if not _HOST_PI_AUTH.is_file():
                raise ValueError(f"{_HOST_PI_AUTH} not found — run 'pi login' first")
            await self.exec_as_root(environment, command=f"mkdir -p {_REMOTE_PI_HOME}")
            await environment.upload_file(str(_HOST_PI_AUTH), f"{_REMOTE_PI_HOME}/auth.json")
            if environment.default_user is not None:
                await self.exec_as_root(
                    environment,
                    command=f"chown -R {environment.default_user} {_REMOTE_PI_HOME}",
                )
            env["PI_CODING_AGENT_DIR"] = _REMOTE_PI_HOME
        else:
            env.setdefault("OPENCODE_API_KEY", self._get_env("OPENCODE_API_KEY") or "")

        thinking_arg = f"--thinking {shlex.quote(thinking)} " if thinking else ""

        # One bash script: edit with Pi (offline flags = no non-provider startup calls), then
        # commit so pre_artifacts.sh sees base..HEAD. Stays exit-0 so a non-zero Pi exit still
        # commits and grades. The repo is the git toplevel (cwd defaults to the env WORKDIR).
        command = (
            'if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi\n'
            f"mkdir -p {agent_dir}\n"
            'cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"\n'
            'git config --global --add safe.directory "$(pwd)" 2>/dev/null || true\n'
            "git config user.email pi@pier.local 2>/dev/null || true\n"
            "git config user.name pi 2>/dev/null || true\n"
            f"printf '%s' {escaped} | timeout {_PI_TIMEOUT_SEC} "
            "pi -p --offline -ne -ns -np --no-themes -nc "
            "--tools read,edit,write,bash,grep,find,ls "
            f"{thinking_arg}"
            f"--model {shlex.quote(model)} 2>&1 | tee {agent_dir}/pi.txt || true\n"
            "git add -A\n"
            'git diff --cached --quiet || git commit -m agent\n'
            "git --no-pager log --oneline -1 2>/dev/null || true\n"
        )

        await self.exec_as_agent(environment, command=command, env=env)

    def populate_context_post_run(self, context: AgentContext) -> None:
        # SUPPORTS_ATIF is False — no trajectory/metrics parsing. Grading is by tests.
        return None
