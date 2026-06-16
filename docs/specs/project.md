# Project — mdtask

# Tasks

- [ ] PRJ-012 Project bootstrap: package, TypeScript, bun test, deps, layout		#poc
  Stand up the project skeleton every other task builds on: a TypeScript project with bun test wired, the @earendil-works/pi-coding-agent dependency (the native Pi host SDK), and the extension entry layout under .pi/extensions/fusion-agents/. Throwaway-POC minimal — no lint / CI / release tooling.

  Constraints: TypeScript + bun test; depend only on @earendil-works/pi-coding-agent (native Pi SDK, no third-party agent packages); add deps via the package manager, never by hand.

  Acceptance: the project typechecks; `bun test` runs green on one trivial test (proves the harness works); dependencies install cleanly.
