"use client";
// Spec: knowledge/components/ask-agent.md
// Models, efforts, limits and the voice switch. Only providers with a key are offered; a change
// applies to sessions started after it, and the audit log below records it.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type Choice, consoleCall, type SettingsView } from "./consoleApi";

const LIMIT_LABELS: Record<string, string> = {
  sessionMinutes: "Session length (minutes)",
  idleMinutes: "Idle timeout (minutes)",
  maxMessages: "Messages per session",
  maxModelCalls: "Model calls per message",
  sessionBudgetUsd: "Budget per session (USD)",
  dailyBudgetUsd: "Budget per day (USD)",
  voiceMinutes: "Voice per session (minutes)",
  voiceDailyMinutes: "Voice per day (minutes)",
};

function ModelPicker({
  label,
  view,
  value,
  onChange,
}: {
  label: string;
  view: SettingsView;
  value?: Choice;
  onChange: (next: Choice) => void;
}) {
  const providers = view.providers.filter((p) => p.keySet).map((p) => p.id);
  const current = value ?? { model: "", effort: "low" };
  const known = view.models.some((m) => m.id === current.model);
  const chosen = view.models.find((m) => m.id === current.model);
  return (
    <fieldset className="panel space-y-3">
      <legend className="px-1 font-serif text-lg">{label}</legend>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Model</span>
        <select
          className="field min-h-11"
          value={current.model}
          onChange={(e) => onChange({ ...current, model: e.target.value })}
        >
          {!current.model && <option value="">No model (unavailable)</option>}
          {current.model && !known && (
            <option value={current.model}>{current.model} (not in catalogue)</option>
          )}
          {providers.map((provider) => (
            <optgroup key={provider} label={provider}>
              {view.models
                .filter((m) => m.id.startsWith(`${provider}/`))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {chosen && (
        <p className="text-xs text-muted tabular-nums">
          ${chosen.cost.input} in · ${chosen.cost.cacheRead} cached · ${chosen.cost.output} out per
          million tokens · {chosen.contextWindow.toLocaleString()} tokens of context
          {chosen.reasoning ? " · reasons" : ""}
        </p>
      )}
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Effort</span>
        <select
          className="field min-h-11"
          value={current.effort}
          onChange={(e) => onChange({ ...current, effort: e.target.value })}
        >
          {view.efforts.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

export function ConsoleSettings() {
  const [view, setView] = useState<SettingsView>();
  const [answer, setAnswer] = useState<Choice>();
  const [guard, setGuard] = useState<Choice>();
  const [voice, setVoice] = useState(false);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);

  const show = useCallback((next: SettingsView) => {
    setView(next);
    setAnswer(next.answer);
    setGuard(next.guard);
    setVoice(next.voice.enabled);
    setLimits(Object.fromEntries(Object.entries(next.limits).map(([k, v]) => [k, String(v)])));
  }, []);
  useEffect(() => {
    void consoleCall<SettingsView>("/settings").then((a) =>
      a.data ? show(a.data) : setMessage({ ok: false, text: a.error ?? "unknown" }),
    );
  }, [show]);

  if (!view)
    return message ? (
      <p className="text-sm text-bad">{message.text}</p>
    ) : (
      <p className="text-sm text-muted">Loading…</p>
    );

  const save = async (event: FormEvent) => {
    event.preventDefault();
    // Only what changed: an unchanged field would still write an audit line.
    const patch: Record<string, unknown> = {};
    if (voice !== view.voice.enabled) patch.voiceEnabled = voice;
    if (answer?.model && JSON.stringify(answer) !== JSON.stringify(view.answer))
      patch.answer = answer;
    if (guard?.model && JSON.stringify(guard) !== JSON.stringify(view.guard)) patch.guard = guard;
    const changed = Object.entries(limits).filter(([k, v]) => Number(v) !== view.limits[k]);
    if (changed.length) patch.limits = Object.fromEntries(changed.map(([k, v]) => [k, Number(v)]));
    if (Object.keys(patch).length === 0) {
      setMessage({ ok: true, text: "Nothing changed." });
      return;
    }
    setBusy(true);
    const result = await consoleCall<SettingsView>("/settings", patch);
    setBusy(false);
    if (result.data) {
      show(result.data);
      setMessage({ ok: true, text: "Saved. New sessions use these settings." });
    } else setMessage({ ok: false, text: result.error ?? "unknown" });
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="panel space-y-2">
        <h2 className="text-lg">Provider keys</h2>
        <p className="text-sm text-muted">Set on the server only. The console never shows a key.</p>
        <ul className="flex flex-wrap gap-2">
          {view.providers.map((p) => (
            <li
              key={p.id}
              className={`pill ${p.keySet ? "border-ok text-ok" : "border-line text-muted"}`}
            >
              {p.id}: {p.keySet ? "key set" : "no key"}
            </li>
          ))}
        </ul>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <ModelPicker label="Answer model" view={view} value={answer} onChange={setAnswer} />
        <ModelPicker label="Guard model" view={view} value={guard} onChange={setGuard} />
      </div>
      <fieldset className="panel space-y-4">
        <legend className="px-1 font-serif text-lg">Limits</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(view.ranges).map(([name, range]) => (
            <label key={name} className="block space-y-1.5 text-sm">
              <span className="font-medium">{LIMIT_LABELS[name] ?? name}</span>
              <input
                type="number"
                inputMode="decimal"
                className="field min-h-11 tabular-nums"
                min={range.min}
                max={range.max}
                step="any"
                value={limits[name] ?? ""}
                onChange={(e) => setLimits({ ...limits, [name]: e.target.value })}
              />
              <span className="block text-xs text-muted">
                {range.min} to {range.max}; default {range.def} ({range.env})
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="panel flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={voice}
          onChange={(e) => setVoice(e.target.checked)}
        />
        <span>
          <span className="font-medium">Voice on OpenAI conversations</span>
          <span className="block text-xs text-muted">
            Model {view.voice.model}; shoppers still need the voice password.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        {message && (
          <p role="status" className={`text-sm ${message.ok ? "text-ok" : "text-bad"}`}>
            {message.text}
          </p>
        )}
      </div>
      <section className="panel space-y-3">
        <h2 className="text-lg">Changes</h2>
        {view.audit.length === 0 ? (
          <p className="text-sm text-muted">No change yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {view.audit.map((line) => (
              <li key={line.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="font-mono text-xs">{line.field}</span>
                <span className="text-xs text-muted">
                  {JSON.stringify(line.from)} → {JSON.stringify(line.to)} ·{" "}
                  {new Date(line.at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </form>
  );
}
