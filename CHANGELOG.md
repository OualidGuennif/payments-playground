# Changelog

Every notable change, newest first ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[SemVer](https://semver.org/)).

## [Unreleased]

- Adopt the Æion Factory v1.7.0 repository and agent architecture in a nine-folder layout; keep the
  root `render.yaml`, the four apps, TEST-only rules and Adyen versions unchanged.
- Move the development and build scripts from `scripts/` to `tools/dev/`, `tools/build/` and
  `tools/knowledge/`; update the root tasks, every app's Vite configuration, the Dockerfiles and the
  knowledge sources.
- Add eight-section component specs for every app and shared package, with `Spec:` pointers in both
  directions and the factory policy set (engineering, security, specs, layout, UI, intake, owner).
- Import the 16 maintained skills and the Claude/Pi/dsh/Codex/OpenCode/Devin/Droid adapters, the
  250k/300k context checkpoint and the git hooks.
- Pin Graphify 0.9.97 and Archify v3.2.0 under the ignored `.aeion/`, replace the factory views with
  the project's architecture, delivery and payment-lifecycle diagrams, and add the exact-commit CI
  refresh.
- Add CI, the reviewed `develop → main` release flow and the optional (off) PR-review and outer-loop
  workflows.
- Split `FlowWorkbench` and `StylingPlayground` below the 1,500-line cap, trim three comment blocks,
  regenerate the efficiency bundle and restore a green `deno task check`.
