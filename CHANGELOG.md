# Changelog

Every notable change, newest first ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[SemVer](https://semver.org/)).

## [Unreleased]

- Adopt the Æion Factory v1.7.0 repository and agent architecture: `tools/` checks, harness
  configuration, knowledge policies and component specs, Graphify/Archify analysis, git hooks, CI
  and a versioned release flow.
- Move the development and build scripts from `scripts/` to `tools/dev/`, `tools/build/` and
  `tools/knowledge/`; update the root tasks, every app's Vite configuration, the Dockerfiles and the
  knowledge sources.
- Restore a green `deno task check`: format the styling stylesheet and type the redirect-return
  timer.
