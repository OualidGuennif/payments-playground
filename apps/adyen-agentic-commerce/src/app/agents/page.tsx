// Spec: knowledge/components/adyen-agentic-commerce.md
import { config } from "@/server/config";

// PUBLIC_ORIGIN is read per request so one image serves any origin.
export const dynamic = "force-dynamic";

export const metadata = { title: "For agents" };

export default function Agents() {
  const o = config().publicOrigin;
  const rows: [string, string][] = [
    ["PAP discovery", `${o}/.well-known/poppy.json`],
    ["UCP profile", `${o}/.well-known/ucp`],
    ["MCP server", `${o}/mcp`],
    ["UCP REST", `${o}/ucp/v1`],
    ["Authorization server", `${o}/.well-known/oauth-authorization-server`],
    ["Protected resource", `${o}/.well-known/oauth-protected-resource`],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <p className="eyebrow">For agents and their developers</p>
        <h1 className="text-3xl">Shop here with any AI agent</h1>
        <p className="text-muted">
          Add <span className="code">{o}/mcp</span> as a remote MCP connector in your assistant. It asks you to sign in here,
          you choose the scopes and a spend limit, and it can then search, build a checkout and pay with your saved card.
        </p>
      </div>
      <section className="panel space-y-3">
        <h2 className="text-xl">Endpoints</h2>
        <dl className="space-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted">{k}</dt>
              <dd className="break-all"><a className="underline" href={v}>{v}</a></dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl">How a purchase works</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Sign in: OAuth 2 authorization code with PKCE S256. PAP clients use a client metadata document as <span className="code">client_id</span> and <span className="code">private_key_jwt</span>; other MCP clients can register at <span className="code">/oauth/register</span>.</li>
          <li>Search with <span className="code">search_catalog</span> and pick variant ids (colour and size).</li>
          <li><span className="code">create_checkout</span> with line items. The store prices everything; amounts are EUR minor units.</li>
          <li>If the status is <span className="code">ready_for_complete</span>, call <span className="code">complete_checkout</span> with the instrument from <span className="code">checkout.payment.instruments</span>. The merchant charges the saved card on Adyen TEST (ContAuth, UnscheduledCardOnFile).</li>
          <li>If the status is <span className="code">requires_escalation</span>, give the shopper <span className="code">continue_url</span>: they review and pay with Drop-in.</li>
        </ol>
      </section>
      <section id="saved-card-handler" className="panel space-y-2 text-sm">
        <h2 className="text-xl">Payment handler <span className="code">saved_card</span></h2>
        <p>
          Declared under <span className="code">com.payments-playground.saved_card</span> in the UCP profile. Instruments are
          aliases of the card the shopper saved with Adyen (shopper reference <span className="code">ogaccountnew</span>); the
          raw Adyen token never leaves the merchant. It needs the <span className="code">ucp:pay</span> scope and a total within
          the grant&apos;s remaining spend limit. Adyen&apos;s own UCP tokenizer can replace it once the account has the role.
        </p>
      </section>
      <section className="space-y-2 text-sm">
        <h2 className="text-xl">Scopes</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><span className="code">ucp:checkout</span> create and update checkouts (changes)</li>
          <li><span className="code">ucp:pay</span> pay with the saved card within the spend limit (changes)</li>
          <li><span className="code">ucp:orders</span> read orders (personal data)</li>
          <li><span className="code">profile</span> name and email (personal data)</li>
        </ul>
      </section>
    </div>
  );
}
