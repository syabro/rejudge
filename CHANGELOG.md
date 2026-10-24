# Changelog

## 0.5.2 — 2026-10-24

### Changed

- The standalone CLI now bundles Pi SDK 1.4.0 instead of 1.3.0.

## 0.5.1 — 2026-10-20

### Fixed

- The standalone CLI now bundles Pi SDK 1.3.0 instead of 0.85.1, allowing Anthropic OAuth reviewers to use models that require Claude Code 2.1.280 or newer.

## 0.5.0 — 2026-10-08

### Changed

- Rejudge looks for `.rejudge/config.json` in the current folder and then in parent folders; the nearest one wins. One config now covers every project below it, and a run from a subfolder uses it instead of `~/.config/rejudge/config.json`. With `debugLog` enabled, logs go to `.rejudge/logs` next to that config.
- The bundled `rejudge` workflow points to `ask-agent-cli` for a single external reviewer.

## 0.4.1 — 2026-09-10

### Changed

- History lookups in Pi show a compact run count. Expanded results show titles, dates, and run IDs instead of JSON and long questions; agents still receive the structured history.

## 0.4.0 — 2026-09-10

### Added

- Saved reviews can be found through the Pi tool's `history` option or CLI `--history`, without calling models.
- New reviews can be linked to the calling conversation with `conversationId` or `--conversation-id`. When the ID is missing or has no matches, history shows recent runs from the current directory.
- History shows run IDs, conversation IDs, titles, question previews, and last successful request times. A successful follow-up refreshes that time and keeps the original conversation and question.
- The workflows tell agents when to continue a review and when to start a separate run, including recovery after conversation compaction, and warn against reusing another conversation's run.

## 0.3.1 — 2026-09-06

### Changed

- The standalone CLI is built on Pi SDK 0.85.1.

## 0.3.0 — 2026-08-29

### Added

- An Ollama provider guide.
- The README names the `TypeError` that an unsupported Node version prints and explains that a version manager can start a different Node than the one Rejudge was installed under.

### Changed

- The standalone CLI is built on Pi SDK 0.84.4.

### Fixed

- Under `NO_COLOR`, terminal answers contain no color codes, including wrapped table cells.

## 0.2.0 — 2026-08-11

### Added

- The CLI sends provider requests through `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`.
- The README names the three Ollama provider settings that fail silently.

### Changed

- A reviewer that returns an empty turn is asked for its answer up to three times before the review fails.

## 0.1.2 — 2026-08-08

Version 0.1.1 was tagged on GitHub but not published to npm; its changes ship in 0.1.2.

### Added

- CLI terminals show the same live progress block as Pi. Pipes and redirects keep the plain log.
- Pi and CLI progress show whether a review is fresh or resumed, with the restored run ID, and which tools reviewers received.
- CLI answers render as Markdown in terminals. Pipes and redirects keep the raw Markdown.
- A positional instruction combines with piped input: `git diff | rejudge "review this change"`.
- The README documents Agent Skills installation and updates with `npx skills add syabro/rejudge -g -y`.

### Changed

- One global npm install serves both the CLI and Pi: `pi install "$(npm root -g)/rejudge"` registers it in Pi. Pi 0.83 or newer is required.
- The workflow commands are `/rejudge` and `/rejudge-diff`.
- The workflows tell agents to run the CLI outside sandboxes, so saved provider login stays available, and to keep Rejudge attached until it exits.
- The package metadata links to the `syabro/rejudge` repository.

### Fixed

- Repeated `ask_panel` questions to the same reviewer wait in a queue; different reviewers still answer in parallel.

## 0.1.0 — 2026-07-15

### Added

- First public release: one `rejudge` npm package with the CLI, the Pi extension, and the `rejudge` and `rejudge-diff` workflows.
