# Public release — mdtask

The first public release is Rejudge 0.1.0 on GitHub and npm, with both the Pi extension and CLI supported.

Existing launch gates are tracked separately and are not duplicated here:
- `EXT-052` — report Esc cancellation as a user cancellation
- `SYN-042` — route duplicate model choices through stable role identities

## Public repository hygiene

The public source tree excludes private planning, local Rejudge and Pi state, editor state, generated bundles, caches, and environment files. Public workflow examples call the installed `rejudge` command instead of an author's checkout. Release preparation scans both the candidate source tree and complete Git history with the default Gitleaks rules; its only exception is the exact synthetic marker used by the resume integration test.

# Tasks

- [ ] REL-054 Package Rejudge 0.1.0 for npm		#release
  `@rejudge/pi` installs as a public package and exposes both the Pi extension and the `rejudge` CLI.

  Add the MIT license and complete the package metadata, public file list, executable mapping, runtime requirements, and build lifecycle. Confirm that the `@rejudge` npm scope can publish a public package.

  User decisions:
  - release under the MIT license
  - publish through both GitHub and npm
  - use version 0.1.0

  DoD:
  - the repository contains the intended MIT `LICENSE`
  - the package declares version, description, license, repository, runtime requirements, public files, and the `rejudge` executable
  - `npm pack` contains the required CLI and Pi bundles but excludes tests, local configuration, logs, benchmarks, and private working files
  - installing the packed tarball in an empty project makes `rejudge --help` work and includes a loadable Pi extension
  - the publishing account can publish public packages under `@rejudge`

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
  `/rejudge` and `/rejudge-diff` work from another user’s installation instead of relying on this machine’s checkout path.

  Replace fixed local paths with a portable way to locate the installed CLI, and document how to install both workflows.

  User decision: publish both workflows as supported public interfaces.

  DoD:
  - neither workflow contains an author-specific absolute path
  - both workflows locate and invoke the installed Rejudge CLI
  - a clean user profile can install and run each workflow using only the public instructions
  - workflow failures explain missing Rejudge installation or authentication clearly

- [ ] REL-057 Write and verify the Pi and CLI quickstart		#release
  A stranger can install, configure, and run Rejudge through Pi or the CLI without private setup knowledge.

  Document supported Node, Bun, and Pi versions; npm and source installation; authentication; model configuration; Pi loading; workflow installation; the first CLI run; the first Pi tool call; and common setup failures.

  User decision: the first public release supports both Pi and CLI.

  DoD:
  - README contains one copy-paste path from an empty machine to a successful CLI review
  - README contains one copy-paste path from an empty machine to a loaded Pi `rejudge` tool
  - config and authentication examples contain no private values
  - every documented command is verified in an isolated home directory or clean environment
  - expected successful output and common failure messages are shown

- [ ] REL-058 Publish the data, cost, and safety contract		#release
  Users understand what leaves their machine, what a review may cost, and what permissions Rejudge receives before running it.

  Explain that prompts and selected project content may be sent to every configured model provider; a run makes several model calls; read-only reviewers can still reveal file contents; debug logs and persisted runs may contain sensitive text; and `--unsafe` grants write and shell access.

  User decision: the first announcement makes no measured claim that Rejudge improves answer quality.

  DoD:
  - README has clear privacy, provider, cost, logging, persistence, and `--unsafe` warnings before the first run instructions
  - the default read-only boundary and its limits are stated accurately
  - public copy promises an independent review process, not guaranteed correctness or measured improvement
  - the release contains no unsupported security or efficacy claim

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
  - publish Pi and CLI together
  - benchmark evidence is not required for this release

  DoD:
  - the public GitHub repository is accessible and its default branch points to the reviewed release commit
  - tag and GitHub release `v0.1.0` point to that commit
  - `npm view @rejudge/pi@0.1.0` succeeds and a clean registry installation works
  - the public README links and installation commands work
  - `EXT-052` and `SYN-042` are complete
