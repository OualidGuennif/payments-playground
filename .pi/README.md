# Pi integration

Read the [setup runbook](../knowledge/operations/agent-compatibility.md).
Pi 1.4.0+ reads the root `AGENTS.md`/`CLAUDE.md` and the shared `.agents/skills` links from any folder
below the root; bodies are maintained once. The project extension in `extensions/factory/` reuses the
existing Python guards, edit checks and handover checkpoints through `tools/agents/hook.py pi`.

Launch with `tools/agents/run pi` and trust the project when Pi asks, so `.pi/extensions/` loads. Pi loads
project extensions from its start folder only: started elsewhere, pass it explicitly
(`pi -e ../.pi/extensions/factory/index.js` from `demo/`). The extension uses Node built-ins only.

It blocks a tool call on any refusal or hook failure, appends edit feedback to the tool result, gives
the factory context once per session and again after a compaction, and cancels a compaction without the
verified handover. Use the shared sign-off skill at task completion. Pi controls its own compaction
window (`compaction.reserveTokens`), but the extension compacts first: at 250k, once the handover is
verified, it calls `ctx.compact()`; at 300k only the handover and its checkpoint remain.
