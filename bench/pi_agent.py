"""A thin pier agent that runs the Pi coding CLI (BENCH-036).

Mirrors the built-in codex agent: install_spec provisions Node + Pi at build time,
run() executes `pi -p` on the task instruction inside the repo, then commits so the
harness's pre_artifacts.sh can capture `git diff base..HEAD`.

Run via bench/run.sh, which clones pier/deep-swe into bench/vendor/ (gitignored) and
invokes pier with PYTHONPATH=bench so this module loads from our repo, not from the
pier checkout.
"""

import shlex

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

    def network_allowlist(self) -> NetworkAllowlist:
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
            raise ValueError("Model name is required (pass --model opencode-go/<id>)")

        agent_dir = EnvironmentPaths.agent_dir.as_posix()
        escaped = shlex.quote(instruction)

        # NODE_USE_ENV_PROXY makes Node 24's fetch honor HTTP(S)_PROXY (the sandbox proxy);
        # OPENCODE_API_KEY authenticates the provider. build_process_env folds in --ae vars.
        env = self.build_process_env({"NODE_USE_ENV_PROXY": "1"})
        env.setdefault("OPENCODE_API_KEY", self._get_env("OPENCODE_API_KEY") or "")

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
            f"--model {shlex.quote(self.model_name)} 2>&1 | tee {agent_dir}/pi.txt || true\n"
            "git add -A\n"
            'git diff --cached --quiet || git commit -m agent\n'
            "git --no-pager log --oneline -1 2>/dev/null || true\n"
        )

        await self.exec_as_agent(environment, command=command, env=env)

    def populate_context_post_run(self, context: AgentContext) -> None:
        # SUPPORTS_ATIF is False — no trajectory/metrics parsing. Grading is by tests.
        return None
