# Public release — mdtask

The first public release is Rejudge 0.1.0 on GitHub and npm. One unscoped npm package, `rejudge`, contains the CLI, Pi extension, and both public workflows. Its manifest exposes the executable and declares the bundled Pi extension and skills, so every interface comes from the same installed artifact.

Existing launch gates are tracked separately and are not duplicated here:
- `EXT-052` — report Esc cancellation as a user cancellation
- `SYN-042` — route duplicate model choices through stable role identities

## Public repository hygiene

The public source tree excludes private planning, local Rejudge and Pi state, editor state, generated bundles, caches, and environment files. Public workflow examples call the installed `rejudge` command instead of an author's checkout. Release preparation scans both the candidate source tree and complete Git history with the default Gitleaks rules; its only exception is the exact synthetic marker used by the resume integration test.

## Data, cost, and safety

A fresh review sends its request to every configured reviewer model. Reviewers may add files, diffs, and optional web-search results to their model sessions. The judge model sees reviewer write-ups and any `ask_panel` replies rather than inspecting the workspace directly; those messages may quote sensitive request or project text. Read-only access prevents local changes, not disclosure, and instructions in inspected content can steer what reviewers read or return. If `web_search` is available and used, its query also goes to that tool's configured service.

A successful fresh review invokes every reviewer and then the judge; tool loops, retries, empty-output recovery, and judge follow-ups can add provider requests. A resumed review restores all sessions but sends its first new turn only to the judge, which re-queries reviewers only through `ask_panel`. Rejudge sets no spending cap; the configured providers and models determine price and rate limits.

Session JSONL is written during execution under `${TMPDIR}/rejudge/runs/<run-id>/`, including for runs that later fail or are cancelled. The files may contain the request, model messages, and tool calls or results. Only a successful manifested run is resumable. Run directories become eligible for best-effort cleanup after about 24 hours when a later fresh review starts; timely deletion is not guaranteed, and OS temp cleanup is separate. Optional debug logs under `.rejudge/logs/` contain full thinking and assistant text plus truncated tool arguments and results.

Reviewers default to read/search/list, `git_diff`, and optional `web_search`; the judge has only `ask_panel`, and the Pi tool never enables write access. A CLI run created with `--unsafe` or `--full` also gives reviewers file-editing and shell tools in the user's environment, without a sandbox; the judge remains limited to `ask_panel`.

Technical completion does not verify the result. Separate initial sessions provide an independent review process, not statistically independent errors, guaranteed correctness, consensus truth, or measured improvement over one strong model.

# Tasks

- [x] REL-054 Package Rejudge 0.1.0 for npm		#release
  The single `rejudge` package installs the CLI, Pi extension, and both public workflows together.

  Add the MIT license and complete the package metadata, public file list, executable mapping, runtime requirements, and build lifecycle. Publish one unscoped package instead of creating separate CLI, Pi, or workflow packages.

  User decisions:
  - release under the MIT license
  - publish through both GitHub and npm
  - use version 0.1.0
  - publish one unscoped npm package named `rejudge`; keep the CLI, Pi extension, and both workflows together

  DoD:
  - the repository contains the intended MIT `LICENSE`
  - the package declares the `rejudge` name, version, description, license, repository, runtime requirements, public files, and executable
  - `npm pack` contains the CLI, Pi bundle, and both workflows but excludes tests, local configuration, logs, benchmarks, and private working files
  - installing the packed tarball in an empty project makes `rejudge --help` work, includes a loadable Pi extension, and provides both workflows
  - package metadata and public instructions use `rejudge` without an npm scope or split package

  **Implemented:**
  - The unscoped `rejudge@0.1.0` manifest exposes the CLI, bundled Pi extension, and both public workflows as one package.
  - The seven-file tarball contains only the license, README, manifest, built entry points, and two workflow definitions.
  - A clean installation with lifecycle scripts disabled runs `rejudge --help`, loads the Pi extension, and discovers `rejudge` and `rejudge-diff`.
  - The installed artifact runs on Node without Bun or source files.

- [x] REL-055 Sanitize the repository for public visibility		#release
  The public repository contains only intentional project material and no local credentials, machine state, or unpublished planning files.

  Keep `PROJECT-AND-NAMING-BRIEF.md` private without editing its contents. Remove machine-specific paths from tracked material, exclude local state, commit the current progress-spacing change, and scan both the current tree and Git history for secrets.

  User decision: `PROJECT-AND-NAMING-BRIEF.md` remains private and untouched.

  DoD:
  - the intended release worktree is clean
  - the naming brief, local configs, logs, generated bundles, editor state, and machine state are not tracked or packed
  - tracked public material contains no absolute path tied to the author’s machine
  - secret scanning passes for the current tree and complete Git history
  - the release diff contains only intentional public changes

  **Implemented:**
  - The private naming brief stays local, ignored, untracked, unchanged, and absent from Git history.
  - Local tool state, editor files, generated bundles, caches, logs, and environment files stay outside the public source tree.
  - Public workflow examples use the installed `rejudge` command and contain no author-specific absolute path or shell setup.
  - Default Gitleaks scans pass for the candidate public tree and all Git refs; only the exact synthetic resume-test marker is exempted.
  - The previously requested progress-row spacing is already present in commit `c565a12`.

- [ ] REL-056 Make the Rejudge workflows portable		#release
  The `/rejudge` and `/rejudge-diff` workflows ship inside the same `rejudge` package and work from any installation.

  Remove author-specific paths, make both workflows invoke the installed `rejudge` command, and document how Pi discovers the workflows from the package.

  User decisions:
  - publish both workflows as supported public interfaces
  - ship both workflows with the CLI and Pi extension in the single `rejudge` package

  DoD:
  - neither workflow contains an author-specific absolute path
  - both workflows ship in the `rejudge` package and invoke its installed CLI
  - a clean user profile can install one package and run each workflow using only the public instructions
  - workflow failures explain missing Rejudge installation or authentication clearly

- [ ] REL-057 Write and verify the Pi and CLI quickstart		#release
  A stranger can install, configure, and run Rejudge through Pi or the CLI without private setup knowledge.

  Document supported Node, Bun, and Pi versions; installation of the single `rejudge` package from npm and source; authentication; model configuration; Pi loading; workflow discovery; the first CLI run; the first Pi tool call; and common setup failures.

  User decisions:
  - the first public release supports both Pi and CLI
  - all public installation paths use the single `rejudge` package

  DoD:
  - README contains one copy-paste path from an empty machine to a successful CLI review
  - README contains one copy-paste path from an empty machine to a loaded Pi `rejudge` tool
  - both paths install `rejudge`, and the same package provides `/rejudge` and `/rejudge-diff`
  - config and authentication examples contain no private values
  - every documented command is verified in an isolated home directory or clean environment
  - expected successful output and common failure messages are shown

- [x] REL-058 Publish the data, cost, and safety contract		#release
  Users understand what leaves their machine, what a review may cost, and what permissions Rejudge receives before running it.

  Explain that prompts and selected project content may be sent to every configured model provider; a run makes several model calls; read-only reviewers can still reveal file contents; debug logs and persisted runs may contain sensitive text; and `--unsafe` grants write and shell access.

  User decision: the first announcement makes no measured claim that Rejudge improves answer quality.

  DoD:
  - README has clear privacy, provider, cost, logging, persistence, and `--unsafe` warnings before the first run instructions
  - the default read-only boundary and its limits are stated accurately
  - public copy promises an independent review process, not guaranteed correctness or measured improvement
  - the release contains no unsupported security or efficacy claim

  **Implemented:**
  - The README warns before installation which request, workspace, and search data can reach configured services.
  - Fresh and resumed reviews have explicit provider-call, rate-limit, and user-owned cost boundaries.
  - Persisted sessions and optional debug logs disclose their sensitive content and best-effort cleanup behavior.
  - Default, Pi, and unsafe CLI permissions are explicit, alongside the limits of procedural independence and technical success.

- [ ] REL-059 Add continuous integration and release checks
  Every public change proves that the source, npm package, CLI, and Pi extension still build and load.

  Add a public CI workflow that uses clean dependencies and no model credentials. Keep real-model integration tests outside untrusted pull requests.

  DoD:
  - CI runs deterministic tests, typecheck, and both builds
  - CI packs the npm tarball and smoke-tests its installed CLI
  - CI verifies that the packed Pi extension loads and registers `rejudge`
  - CI uses declared runtime versions and no private credentials
  - the release commit has a green CI result

- [ ] REL-060 Publish Rejudge 0.1.0		#release
  The same verified release is available from GitHub and npm.

  Do not start this task until the release tasks above and existing gates `EXT-052` and `SYN-042` are complete. Create the public GitHub repository, push the reviewed tree, tag the release, publish npm interactively, and verify both installation paths.

  User decisions:
  - release through public GitHub and npm
  - publish the CLI, Pi extension, and both workflows together as the single `rejudge` package
  - benchmark evidence is not required for this release

  DoD:
  - the public GitHub repository is accessible and its default branch points to the reviewed release commit
  - tag and GitHub release `v0.1.0` point to that commit
  - `npm view rejudge@0.1.0` succeeds and a clean registry installation provides the CLI, Pi extension, and both workflows
  - the public README links and installation commands work
  - `EXT-052` and `SYN-042` are complete
