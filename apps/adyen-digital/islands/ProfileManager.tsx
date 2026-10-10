import { apiFetch } from "@suite/ui/client.ts";
import { Field } from "@suite/ui/components.tsx";
import { useCopy } from "@suite/ui/useCopy.ts";
import { useEffect, useState } from "preact/hooks";

interface Profile {
  id: string;
  label: string;
  isDefault: boolean;
  isConfigured: boolean;
  missingFields: string[];
  merchantAccount?: string;
  updatedAt: string;
}

interface Bootstrap {
  profile: Profile;
  profiles: Profile[];
  clientKey: string | null;
  webhookUrl: string;
  webhookHmacConfigured: boolean;
}

export default function ProfileManager() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [merchantAccount, setMerchantAccount] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [hmacKey, setHmacKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  async function load() {
    setBootstrap(await apiFetch<Bootstrap>("/api/bootstrap"));
  }

  useEffect(() => {
    load().catch((cause) => setError(cause instanceof Error ? cause.message : "Load failed."));
  }, []);

  async function save(event: Event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/profiles", {
        method: "POST",
        body: JSON.stringify({
          label,
          secrets: { apiKey, merchantAccount, clientKey, hmacKey },
        }),
      });
      setLabel("");
      setApiKey("");
      setMerchantAccount("");
      setClientKey("");
      setHmacKey("");
      setMessage("Profile encrypted and stored on the server.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function select(id: string) {
    await apiFetch("/api/profiles/preferred", {
      method: "POST",
      body: JSON.stringify({ profileId: id }),
    });
    await load();
  }

  async function remove(id: string, name: string) {
    if (!globalThis.confirm(`Delete the profile "${name}"? This cannot be undone.`)) return;
    await apiFetch(`/api/profiles/${id}`, { method: "DELETE" });
    await load();
  }

  const active = bootstrap?.profile;

  return (
    <div class="settings">
      {error ? <div class="notice notice--danger" role="alert">{error}</div> : null}
      {message ? <div class="notice" role="status">{message}</div> : null}

      <section class="settings-card">
        <header class="settings-card__head">
          <h2>Connection</h2>
          {active
            ? (
              <span
                class={`status-pill status-pill--${active.isConfigured ? "positive" : "warning"}`}
              >
                {active.isConfigured ? "Ready" : "Incomplete"}
              </span>
            )
            : null}
        </header>
        {active
          ? (
            <dl class="facts settings-facts">
              <dt>Profile in use</dt>
              <dd>{active.label}</dd>
              <dt>Merchant account</dt>
              <dd>{active.merchantAccount ?? "Not set"}</dd>
              <dt>Client key</dt>
              <dd>{bootstrap?.clientKey ? "Set (test_…)" : "Missing"}</dd>
              {!active.isConfigured
                ? (
                  <>
                    <dt>Missing</dt>
                    <dd>{active.missingFields.join(", ")}</dd>
                  </>
                )
                : null}
              <dt>Webhook HMAC key</dt>
              <dd>{bootstrap?.webhookHmacConfigured ? "Set" : "Missing: webhooks are rejected"}</dd>
              <dt>Webhook URL</dt>
              <dd>
                <button
                  type="button"
                  class="text-button mono"
                  onClick={() => copy(bootstrap?.webhookUrl ?? "", { raw: true })}
                >
                  {copied === bootstrap?.webhookUrl ? "Copied" : bootstrap?.webhookUrl}
                </button>
              </dd>
            </dl>
          )
          : <p class="muted">Loading…</p>}
        <p class="settings-note">
          Point a TEST standard webhook at this URL and put its HMAC key in the profile. API and
          HMAC keys stay on the server: they are encrypted at rest and never sent to the browser.
        </p>
      </section>

      <section class="settings-card">
        <header class="settings-card__head">
          <h2>Profiles</h2>
        </header>
        <ul class="profile-list">
          {bootstrap?.profiles.map((profile) => (
            <li class="profile-item" key={profile.id}>
              <span class="profile-item__main">
                <strong>{profile.label}</strong>
                <small>
                  {profile.isDefault ? "From environment variables · " : ""}
                  {profile.isConfigured
                    ? "Ready for Adyen TEST"
                    : `Missing ${profile.missingFields.join(", ")}`}
                </small>
              </span>
              <span class="profile-item__actions">
                {bootstrap.profile.id === profile.id
                  ? <span class="status-pill status-pill--positive">In use</span>
                  : (
                    <button
                      class="button button--secondary button--small"
                      type="button"
                      onClick={() => select(profile.id)}
                    >
                      Use
                    </button>
                  )}
                {!profile.isDefault
                  ? (
                    <button
                      class="button button--danger button--small"
                      type="button"
                      onClick={() => remove(profile.id, profile.label)}
                    >
                      Delete
                    </button>
                  )
                  : null}
              </span>
            </li>
          ))}
        </ul>

        <details class="settings-add">
          <summary>Add a TEST profile</summary>
          <form class="settings-form" onSubmit={save}>
            <Field label="Name" htmlFor="profile-label">
              <input
                id="profile-label"
                required
                minlength={2}
                value={label}
                onInput={(event) => setLabel(event.currentTarget.value)}
              />
            </Field>
            <Field label="Merchant account" htmlFor="merchant-account">
              <input
                id="merchant-account"
                required
                autocomplete="off"
                value={merchantAccount}
                onInput={(event) => setMerchantAccount(event.currentTarget.value)}
              />
            </Field>
            <Field
              label="API key"
              htmlFor="api-key"
              hint="Customer Area, Developers, API credentials"
            >
              <input
                id="api-key"
                type="password"
                required
                autocomplete="new-password"
                value={apiKey}
                onInput={(event) => setApiKey(event.currentTarget.value)}
              />
            </Field>
            <Field label="Client key" htmlFor="client-key" hint="Starts with test_">
              <input
                id="client-key"
                type="password"
                required
                autocomplete="new-password"
                value={clientKey}
                onInput={(event) => setClientKey(event.currentTarget.value)}
              />
            </Field>
            <Field
              label="Webhook HMAC key"
              htmlFor="hmac-key"
              hint="Optional; needed to accept webhooks"
            >
              <input
                id="hmac-key"
                type="password"
                autocomplete="new-password"
                value={hmacKey}
                onInput={(event) => setHmacKey(event.currentTarget.value)}
              />
            </Field>
            <button class="button button--primary button--block" type="submit" disabled={saving}>
              {saving ? "Encrypting…" : "Save profile"}
            </button>
            <p class="settings-note">
              TEST values only: LIVE client keys and LIVE endpoints are rejected.
            </p>
          </form>
        </details>
      </section>
    </div>
  );
}
