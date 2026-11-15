// Spec: knowledge/operations/agent-compatibility.md
import { seam } from './seam.js';

// A separate entry, so a profile without a root compaction service leaves only this one pending, not the guards.
export const name = 'aeion-template-compaction';
export const inject = ['compaction'];

export function apply(ctx) {
  seam.compaction = ctx.compaction;
}
