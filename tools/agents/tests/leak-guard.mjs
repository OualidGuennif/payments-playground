// Spec: knowledge/operations/context-safety.md
// The adapter suites drive the real hook against this repository, so a closure they reach writes a handover
// skeleton into the real work/handovers/. This removes what the suite's own sessions wrote and fails the suite
// when any other new skeleton of its provider appears, so test debris never passes for an abandoned closure.
import { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const handovers = join(root, 'work/handovers');

const names = () => new Set(existsSync(handovers) ? readdirSync(handovers) : []);

// The key tools/agents/hook.py derives from a native session id: provider, a dash, 40 hex digits of SHA-256.
const keyOf = (provider, id) => `${provider}-${createHash('sha256').update(id).digest('hex').slice(0, 40)}`;

export function guardProjectState(provider, ids) {
  let known;
  before(() => { known = names(); });
  after(() => {
    for (const key of ids.map((id) => keyOf(provider, id))) {
      rmSync(join(handovers, `${key}.md`), { force: true });
      for (const suffix of ['json', 'lock']) rmSync(join(root, '.aeion/context', `${key}.${suffix}`), { force: true });
    }
    const leaked = [...names()].filter((name) => !known.has(name) && name.startsWith(`${provider}-`));
    assert.deepEqual(leaked, [], `the ${provider} suite left handovers in work/handovers/; add their session ids to guardProjectState`);
  });
}
