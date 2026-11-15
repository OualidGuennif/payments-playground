---
type: Runbook
title: "Getting started with Æion Template"
description: "First-run setup, new and existing projects, managed launch commands and dsh troubleshooting."
status: stable
review_after: 2027-01-29
generated:
  by: aeion-adoption/1.0
  at: 2026-11-15
sources:
  - resource: ../../README.md
    title: "Project setup and deployment"
  - resource: ../../AGENTS.md
    title: "The merged agent rules"
  - resource: ../../tools/agents/run
    title: "The managed harness launcher"
---

# Getting started

[Back to the overview](../../README.md) · [Agent compatibility and limits](agent-compatibility.md)

The launcher installs nothing. Install and connect your chosen agent separately, then trust the
project and approve its hooks as required below. The optional team git flow, framework mode, doc
gate mode, plugins and loops are described in [the overview](../../README.md#enable-optional-tools).

## Prepare your agent

Git and **Python 3.12+** for the checks and hooks. Shell tools support macOS, Linux and WSL. Install
`gh` for the GitHub PR workflow and your chosen agent separately. The playgrounds need **Bun 1.4+**;
until the move off Deno is finished, `deno task check` also needs Deno 2.9.4:

- [Claude Code](https://code.claude.com/docs/en/setup)
- [Codex](https://learn.chatgpt.com/docs/cli)
- [OpenCode V2](https://opencode.ai/v2/docs/) — 2.1.4+ for Æion Template's native plugin
- [Pi](https://github.com/earendil-works/pi) — 1.4.0+ for Æion Template's extension
- DeepSeek Harness (`dsh`) — 0.2.1+, loads `.dsh/` through `tools/agents/run dsh`
- [Devin CLI](https://docs.devin.ai/cli/extensibility) — reads `.devin/`, `AGENTS.md` and
  `.agents/skills`
- [Droid](https://docs.factory.ai/cli/configuration/hooks-guide), the CLI of Factory (factory.ai), a
  separate product — reads `.factory/settings.json`, `AGENTS.md` and `.agents/skills`
- [Google Antigravity](https://antigravity.google/docs/hooks) (`agy` CLI or IDE) — reads
  `AGENTS.md`, `.agents/skills` and `.agents/hooks.json`

Keep authentication, provider and model choices in the agent's native user settings. Never commit
credentials to the project.

For an existing Æion Template checkout, use the first-run preparation in step 2 of
[New project](#new-project) without resetting its release metadata. Check hook loading as described
in step 3. A present configuration file alone does not prove the hooks are active.

## New project

1. [Create a repository from this template](https://github.com/OualidGuennif/aeion-template/generate),
   then clone your new repository and open its folder. Reset the copied release metadata and tasks:
   `tools/release/release --new-project` (version 0.1.0, an empty changelog, one task: adapt the
   template to this project).
2. Prepare your harness (once), then start it in that folder:

   | Harness            | Start                           | What to do first                                                                                                                                                                 |
   | ------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Claude Code        | `claude`                        | Trust the folder. Hooks (`.claude/settings.json`) and skills load on their own; check with `/hooks`.                                                                             |
   | Codex              | `codex`                         | Trust the project, enable its hooks in `/hooks`, then restart Codex. Skills come from `.agents/skills`.                                                                          |
   | OpenCode 2.1.4+    | `opencode`                      | Connect your provider in OpenCode. The root `opencode.json` and `.opencode/plugins/template/` load on their own; on a database conflict, `tools/agents/run opencode --isolated`. |
   | Pi 1.4.0+          | `pi`                            | Accept the trust prompt, so `.pi/extensions/template/` loads (the startup list names `template`). Connect your provider in Pi.                                                   |
   | dsh 0.2.1+         | `tools/agents/run dsh` (web UI) | The launcher loads the adapter; connect your provider in dsh. [dsh in detail](#deepseek-harness-dsh-in-detail)                                                                   |
   | Devin CLI          | `devin`                         | Approve the project hooks (`.devin/`).                                                                                                                                           |
   | Droid (factory.ai) | `droid`                         | Approve the project hooks (`.factory/settings.json`).                                                                                                                            |
   | Google Antigravity | `agy`                           | Trust the folder; hooks come from `.agents/hooks.json`.                                                                                                                          |

3. Check the hooks: ask the agent to run `cat .env`. The guard must refuse it and name its rule. If
   it runs, the hooks are not loaded: redo step 2.
4. Give the agent this setup request:

   > Read AGENTS.md, README.md and knowledge/index.md. Prepare Æion Template for this new project:
   > describe the project and owner, add its actual build/test commands, write the first component
   > docs with me in the eight sections of knowledge/policies/specs-first.md, and configure my
   > chosen agent's native setup. Run the checks. Ask me before enabling the Git hooks. Keep one
   > maintained source for instructions, Knowledge and skills. Report anything that still needs
   > configuration. Wait for approval before implementing application features.

5. Turn on the team git flow when the project has a remote and reviews (see
   [optional tools](../../README.md#enable-optional-tools)).
6. From then on, start work with the managed launcher (`tools/agents/run <harness>`, below).
   Configure [GitHub main protection](github-protection.md) in the new repository; GitHub settings
   are not copied by templates.

## Existing project

1. Open your **existing project folder** with your harness. Keep its current instructions,
   configuration, tests and Git history.
2. Make a local reference copy of Æion Template, or point the agent at a reference folder you
   already have:

   ```bash
   git clone https://github.com/OualidGuennif/aeion-template.git ../aeion-template-reference
   ```

3. Give the agent this adoption request, replacing the reference path:

   > Read ../aeion-template-reference/AGENTS.md, its README.md and the adopt skill. Inspect this
   > project's existing instructions, docs, CI, skills and hooks first. Propose the smallest
   > adoption plan, one phase at a time. Merge useful Æion Template pieces into what exists;
   > preserve my project's authority, conventions and working tools. Include native setup for my
   > agent, docs linked to the code they describe and relevant checks; offer the Git hooks and ask
   > me before installing anything. Wait for my approval before changing files.

4. Approve the fitting phases, validate each one and deliver through your project's PR workflow.
   This first session has no Æion Template hooks yet: they arrive with the phase that copies your
   harness's native files. Once that phase is merged, restart the harness and do what it needs:

   | Harness                   | Files the adoption brings                                            | After the merge                                                                                         |
   | ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
   | Claude Code               | `.claude/settings.json` hooks, `.claude/skills/` (merged with yours) | Restart; check `/hooks`                                                                                 |
   | Codex                     | `.codex/config.toml`, `.codex/hooks.json`, `.agents/skills` links    | Trust the project, enable the hooks in `/hooks`, restart                                                |
   | OpenCode                  | `opencode.json` (merged with yours), `.opencode/plugins/template/`   | Restart; reconnect the provider if you use `--isolated`                                                 |
   | Pi                        | `.pi/extensions/template/`, `.agents/skills` links                   | Restart from the project root and accept the trust prompt                                               |
   | dsh                       | `.dsh/`, `.agents/skills` links                                      | Start with `tools/agents/run dsh [web\|headless]`; see [dsh in detail](#deepseek-harness-dsh-in-detail) |
   | Devin, Droid, Antigravity | `.devin/`, `.factory/`, `.agents/hooks.json`                         | Approve the project hooks or trust the folder                                                           |
   | Grok                      | `.grok/hooks/template.json`                                          | Trust the folder; `/hooks` lists it. The Claude budget hook ignores a Grok envelope                     |

5. Check the hooks as in a new project (step 3), then say yes to the Git hooks unless your policy
   forbids them. Use [the adopt skill](../../.claude/skills/adopt/SKILL.md) and
   [runtime setup](agent-compatibility.md) for exact requirements.

## Start a prepared project

Run these from the repository root. Additional arguments are native CLI arguments.

| Agent              | Command                                | Configuration                                                                          |
| ------------------ | -------------------------------------- | -------------------------------------------------------------------------------------- |
| Claude Code        | `tools/agents/run claude`              | Existing `.claude/settings.json`, hooks and skills                                     |
| Codex              | `tools/agents/run codex`               | Trusted `.codex/config.toml` / `hooks.json`, shared `.agents/skills`                   |
| OpenCode           | `tools/agents/run opencode`            | Root `opencode.json`, native V2 plugin in `.opencode/plugins/template/`                |
| Pi                 | `tools/agents/run pi`                  | Extension in `.pi/extensions/template/`, loaded once the project is trusted            |
| dsh                | `tools/agents/run dsh [web\|headless]` | Plugin in `.dsh/plugins/template/`, loaded by `.dsh/template.patch.yml`                |
| Devin CLI          | `tools/agents/run devin`               | `.devin/hooks.v1.json` and `config.json`, `AGENTS.md`, shared `.agents/skills`         |
| Droid (factory.ai) | `tools/agents/run droid`               | `.factory/settings.json` hooks, `AGENTS.md`, shared `.agents/skills`                   |
| Google Antigravity | `tools/agents/run antigravity`         | `.agents/hooks.json`, `AGENTS.md`, shared `.agents/skills`                             |
| Grok               | `tools/agents/run grok`                | `.grok/hooks/template.json`, `AGENTS.md`, shared `.claude/skills` and `.agents/skills` |

The launchers enter the project root and start the agent with its adapter; they install nothing. The
original Claude entry point, `tools/context/run`, also remains available.

### DeepSeek Harness (dsh) in detail

dsh loads the template only through a patch on its command line; `tools/agents/run dsh` adds it.

- **Start.** `tools/agents/run dsh` opens `web`; `tools/agents/run dsh headless "<task>"` answers
  one task (`--session-id <id>` continues it). The desktop app does not load the patch, and there is
  no `tui` profile.
- **Outside the root.** Put the patch right after the profile:
  `dsh web --patch <root>/.dsh/template.patch.yml --port 0` (`--port 0` avoids a second server on
  3080).
- **Compaction.** Past 340k with a verified handover, dsh compacts and resumes from the handover. If
  it does not, stop the session and start a new one from the handover. In `web`, the startup line
  `aeion-template-compaction ... pending` is expected.
- **Check it is loaded.** Ask the agent to run `cat .env`: the guard must refuse it.
- **Versions.** dsh 0.2.1+ (`dsh --version`); connect your provider in dsh's own settings.

Details: [agent compatibility](agent-compatibility.md).
