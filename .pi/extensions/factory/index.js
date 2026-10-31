// Spec: knowledge/operations/agent-compatibility.md
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const UNAVAILABLE = 'Æion Factory hook unavailable; action refused.';
const RESUME = 'Æion Factory: context compacted. Read your handover in work/handovers/ and continue the task.';
// Pi's built-in tools under the names the shared guards know; find and ls only list paths.
const TOOLS = { bash: 'Bash', powershell: 'Bash', read: 'Read', edit: 'Edit', write: 'Write', grep: 'Grep', find: 'Glob', ls: 'LS' };

// Pi may start in a subfolder (demo/), so the hooks live in the nearest folder above that has them.
function projectRoot(directory) {
  for (let folder = resolve(directory); ; folder = dirname(folder)) {
    if (existsSync(resolve(folder, 'tools/agents/hook.py'))) return folder;
    if (dirname(folder) === folder) return directory;
  }
}

function invoke(root, event) {
  const result = spawnSync('python3', [resolve(root, 'tools/agents/hook.py'), 'pi'], {
    cwd: root, input: JSON.stringify(event), encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(UNAVAILABLE);
  const output = JSON.parse(result.stdout);
  const reason = output.stopReason || (output.decision === 'block' && output.reason)
    || (output.hookSpecificOutput?.permissionDecision === 'deny' && output.hookSpecificOutput.permissionDecisionReason);
  return { output, reason };
}

function toolEvent(event, ctx, name) {
  // An unknown tool that carries a command string is a shell call until proven otherwise.
  const shell = !(event.toolName in TOOLS) && typeof event.input?.command === 'string';
  return {
    session_id: ctx.sessionManager.getSessionId(), hook_event_name: name, tool_use_id: event.toolCallId,
    tool_name: shell ? 'Bash' : TOOLS[event.toolName] || event.toolName, tool_input: event.input,
    // Pi's own context measure feeds the shared 250k/300k rule; null right after a compaction.
    observed_tokens: ctx.getContextUsage?.()?.tokens ?? null,
  };
}

export default function (pi) {
  // Sessions given the factory's start context; a compaction removes one, so its next run is told again.
  const started = new Set();
  const compacted = new Set();

  pi.on('before_agent_start', async (event, ctx) => {
    const session = ctx.sessionManager.getSessionId();
    if (started.has(session)) return undefined;
    const source = compacted.has(session) ? 'compact' : 'startup';
    const { output, reason } = invoke(projectRoot(ctx.cwd), { session_id: session, hook_event_name: 'SessionStart', source });
    if (reason) throw new Error(reason);
    started.add(session);
    compacted.delete(session);
    const content = output.hookSpecificOutput?.additionalContext;
    return content ? { message: { customType: 'aeion-factory', content, display: false } } : undefined;
  });

  pi.on('tool_call', async (event, ctx) => {
    try {
      const { reason } = invoke(projectRoot(ctx.cwd), toolEvent(event, ctx, 'PreToolUse'));
      return reason ? { block: true, reason } : undefined;
    } catch (error) {
      return { block: true, reason: error.message || UNAVAILABLE };
    }
  });

  pi.on('tool_result', async (event, ctx) => {
    if (event.isError) return undefined;
    const { reason, output } = invoke(projectRoot(ctx.cwd), toolEvent(event, ctx, 'PostToolUse'));
    // A verified handover past 250k compacts now, not at Pi's own threshold near the model window.
    // Compacting aborts the running turn, so the session is told to resume from its handover once it is done.
    if (output.aeion?.compact) ctx.compact({ onComplete: () => pi.sendUserMessage(RESUME) });
    const message = reason || output.hookSpecificOutput?.additionalContext;
    if (!message) return undefined;
    return { content: [...event.content, { type: 'text', text: `Æion Factory feedback: ${message}` }], structuredContent: event.structuredContent };
  });

  // The run's settlement is the factory's Stop: a sign-off finding asks for one more model request. The hook
  // shows each finding once per session, so the next settlement passes and this cannot loop.
  pi.on('agent_before_settle', async (event, ctx) => {
    try {
      const { reason } = invoke(projectRoot(ctx.cwd), { session_id: ctx.sessionManager.getSessionId(), hook_event_name: 'Stop' });
      if (!reason) return undefined;
      return { entries: [{ type: 'custom_message', customType: 'aeion-factory', content: reason, display: true }], continue: true };
    } catch (error) {
      ctx.ui.notify(error.message || UNAVAILABLE, 'error');
      return undefined;
    }
  });

  pi.on('session_before_compact', async (event, ctx) => {
    const session = ctx.sessionManager.getSessionId();
    let reason;
    try {
      ({ reason } = invoke(projectRoot(ctx.cwd), { session_id: session, hook_event_name: 'PreCompact' }));
    } catch (error) {
      reason = error.message || UNAVAILABLE;
    }
    if (!reason) return undefined;
    ctx.ui.notify(reason, 'error');
    return { cancel: true };
  });

  pi.on('session_compact', async (event, ctx) => {
    started.delete(ctx.sessionManager.getSessionId());
    compacted.add(ctx.sessionManager.getSessionId());
  });
}
