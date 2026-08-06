# Agent Skills — mdtask

Rejudge includes Agent Skills that let coding agents use the installed Rejudge engine.

## Installation

Install Rejudge with npm. Pi discovers the skills through package registration; see [cli.md](cli.md) for the commands. Outside Pi, connect them to supported coding agents with `npx skills add syabro/rejudge -g`; this path does not require Pi.

## Runtime

The [`rejudge`](../skills/rejudge/SKILL.md) skill starts a general review. The [`rejudge-diff`](../skills/rejudge-diff/SKILL.md) skill applies a code-review prompt to a diff. They select different prompts, not different review engines.

When the host exposes the native `rejudge` tool, the skills use it. Otherwise, they run the installed `rejudge` CLI from the project root being reviewed. The tool contract lives in [extension.md](extension.md); the command contract lives in [cli.md](cli.md).

## Configuration and follow-ups

Both routes resolve the same project or global configuration and create the same saved runs. A skill continues a run with the same run ID: `resumeRunId` through the Pi tool or `--resume` through the CLI. Configuration rules live in [config.md](config.md); each interface defines its resume argument in its own contract.

## Updates

When Pi is registered to the npm-installed package directory, that package supplies the review engine, Pi extension, and Pi-discovered skills, so npm updates them together. Skills copied into other agents are separate copies and are not updated by npm. After a Rejudge release, update global Agent Skills with `npx skills update -g -y`.

## Verification

Package smoke tests verify that both skills ship, Pi discovers them, and the public Skills CLI command installs both files outside Pi.

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

- [x] SKL-076 Define the Agent Skills contract		#public-release
  Agent Skills have one documented relationship with the Pi tool, CLI, configuration, saved runs, and updates.

  The current behavior is split between the skill files, CLI spec, extension spec, and public documentation.

  DoD: this spec defines installation, Pi tool use, CLI fallback, configuration, follow-up runs, and updates without copying the CLI or extension specifications.

  **Implemented:**
  - The contract selects the native Pi tool when available and the installed CLI otherwise.
  - Both routes share configuration and saved runs while using their own resume argument.
  - npm updates the Pi-registered package; copies installed into other agents remain separate.

- [x] SKL-077 Verify Agent Skills outside Pi		#public-release
  A clean installation proves that the public command installs both Agent Skill files.

  Current package smoke tests prove that the files ship and Pi discovers them, but do not run the public Agent Skills installer.

  DoD: package smoke runs the public command in an isolated user directory and verifies that `rejudge/SKILL.md` and `rejudge-diff/SKILL.md` were installed.

  **Implemented:**
  - The `skills` smoke target runs the public installer with an isolated home directory.
  - The target requires both installed `SKILL.md` files.

- [x] SKL-078 Normalize the public Rejudge skill commands		#public-release
  Public instructions consistently use `/rejudge` and `/rejudge-diff`.

  Current documentation and specifications still contain the old namespaced form.

  DoD: current user documentation and feature descriptions use only `/rejudge` and `/rejudge-diff`.

  **Implemented:**
  - README and current specifications use `/rejudge` and `/rejudge-diff`.
  - The old namespaced command form no longer appears in current Markdown.

- [x] SKL-079 Define Agent Skills updates		#public-release
  Existing Agent Skills can be updated independently from the npm package through a documented and verified command.

  npm updates the Rejudge engine and Pi extension but does not update skills installed into other coding agents.

  DoD: public instructions contain a verified Agent Skills update path and explain when it is needed.

  **Implemented:**
  - README and the landing page show `npx skills update -g -y`.
  - The instructions explain that copies installed outside Pi require a separate update after a Rejudge release.
