# Agent Skills — mdtask

Rejudge includes Agent Skills that let coding agents use the installed Rejudge engine. Pi uses its native Rejudge tool; other agents use the CLI.

## Installation

Install Rejudge with npm. Outside Pi, connect it to supported coding agents with `npx skills add syabro/rejudge -g`; this path does not require Pi.

# Tasks

- [x] SKL-075 Document Agent Skills installation		#public-release
  Public instructions give non-Pi users one verified way to connect Rejudge to their coding agent.

  The README and landing page currently explain the npm package and Pi integration but not Agent Skills installation.

  User decisions:
  - use `npx skills add syabro/rejudge -g`
  - do not add `@latest`
  - do not list individual skills in the install command

  DoD: the README and landing page explain that npm installs Rejudge and the `skills` command connects it to coding agents outside Pi.

  **Implemented:**
  - README and both landing-page languages show the public Agent Skills installation command.
  - The instructions separate npm installation, non-Pi agent connection, and Pi connection.

- [ ] SKL-076 Define the Agent Skills contract		#public-release
  Agent Skills have one documented relationship with the Pi tool, CLI, configuration, saved runs, and updates.

  The current behavior is split between the skill files, CLI spec, extension spec, and public documentation.

  DoD: this spec defines installation, Pi tool use, CLI fallback, configuration, follow-up runs, and updates without copying the CLI or extension specifications.

- [ ] SKL-077 Verify Agent Skills outside Pi		#public-release
  A clean non-Pi installation proves that an installed Agent Skill can reach Rejudge through the CLI.

  Current package smoke tests prove that the skill files ship and Pi discovers them, but do not cover another coding agent.

  DoD: package smoke installs Agent Skills through the public command in an isolated user directory, verifies discovery by one supported non-Pi agent, and verifies the CLI fallback.

- [ ] SKL-078 Normalize the public Rejudge skill commands		#public-release
  Public instructions consistently use `/rejudge` and `/rejudge-diff`.

  Current documentation and specifications still contain the old `/skill:rejudge` form.

  DoD: current user documentation and feature descriptions contain no `/skill:rejudge` or `/skill:rejudge-diff` commands.

- [ ] SKL-079 Define Agent Skills updates		#public-release
  Existing Agent Skills can be updated independently from the npm package through a documented and verified command.

  npm updates the Rejudge engine and Pi extension but does not update skills installed into other coding agents.

  DoD: public instructions contain a verified Agent Skills update path and explain when it is needed.
