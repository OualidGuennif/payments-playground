// Spec: knowledge/components/adyen-agentic-commerce.md
import { config } from "@/server/config";
import { ADVERTISED_SCOPES, DEVICE_GRANT, SCOPES } from "@/server/oauth";
import { HARD_GATES } from "@/server/ucp";

// PUBLIC_ORIGIN is read per request so one image serves any origin.
export const dynamic = "force-dynamic";

export const metadata = { title: "For agents" };

const CHANGES = {
  none: "reads only",
  reversible: "changes that can be undone",
  irreversible: "changes that cannot be undone",
} as const;

const WEBMCP_TOOLS: [string, string][] = [
  ["search_catalog", "products, prices, colours and sizes in stock (read-only)"],
  ["view_cart", "the cart on this site (read-only)"],
  ["add_to_cart", "a product in a colour and size"],
  ["update_cart_item", "a line's quantity; 0 removes it"],
  ["start_checkout", "opens the checkout page, where you pay yourself"],
];

export default function Agents() {
  const o = config().publicOrigin;
  const rows: [string, string][] = [
    ["MCP server", `${o}/mcp`],
    ["PAP discovery", `${o}/.well-known/poppy.json`],
    ["UCP profile", `${o}/.well-known/ucp`],
    ["UCP REST", `${o}/ucp/v1`],
    ["OpenAPI", `${o}/ucp/v1/openapi.json`],
    ["Authorization server", `${o}/.well-known/oauth-authorization-server`],
    ["Protected resource", `${o}/.well-known/oauth-protected-resource/mcp`],
    ["Device sign-in", `${o}/device`],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="max-w-[68ch] space-y-2">
        <h1 className="text-3xl">Shop here with any AI agent</h1>
        <p className="text-muted">
          Add <span className="code">{o}/mcp</span> as a remote MCP connector in your assistant. It
          asks you to sign in here, you choose what it may do and how much it may spend, and it can
          then search, build a checkout and pay with your saved card.
        </p>
      </div>

      <section className="panel space-y-3">
        <h2 className="text-xl">Endpoints</h2>
        <dl className="space-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted">{k}</dt>
              <dd className="break-all">
                <a className="underline" href={v}>
                  {v}
                </a>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="max-w-[68ch] space-y-3">
        <h2 className="text-xl">What your MCP host needs</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>
            Remote MCP servers over Streamable HTTP. A host that only starts local (stdio) servers
            cannot connect.
          </li>
          <li>
            OAuth for MCP: on the first <span className="code">401</span> it reads{" "}
            <span className="code">resource_metadata</span> from{" "}
            <span className="code">WWW-Authenticate</span>, finds the authorization server, and
            signs in with PKCE S256.
          </li>
          <li>
            A sign-in callback your browser can reach: a loopback address or an https page of the
            host. A host that runs elsewhere, such as a server or a terminal session, uses the
            device sign-in below instead.
          </li>
          <li>
            Tool results passed to the model, and links shown to you: when a payment needs you, the
            answer carries a <span className="code">continue_url</span> to open.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl">Two kinds of clients</h2>
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div className="panel space-y-2">
            <h3 className="font-medium">Any MCP client</h3>
            <p className="text-muted">
              Registers itself at <span className="code">/oauth/register</span> (RFC 7591) and gets
              a public <span className="code">client_id</span>, with no secret. PKCE proves the
              sign-in; the access token goes in each request.
            </p>
          </div>
          <div className="panel space-y-2">
            <h3 className="font-medium">A PAP 1.0 agent</h3>
            <p className="text-muted">
              Its <span className="code">client_id</span> is the URL of its metadata document. It
              signs a client assertion with a key from its <span className="code">jwks_uri</span> (
              <span className="code">private_key_jwt</span>) and can add a signed{" "}
              <span className="code">Poppy-Session</span> to each call.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-[68ch] space-y-3">
        <h2 className="text-xl">Device sign-in</h2>
        <p className="text-sm text-muted">
          For an agent whose sign-in page cannot call it back (RFC 8628). The client declares{" "}
          <span className="code break-all">{DEVICE_GRANT}</span> in its{" "}
          <span className="code">grant_types</span>.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            The agent posts its <span className="code">client_id</span> and{" "}
            <span className="code">scope</span> to{" "}
            <span className="code">/oauth/device_authorization</span> and shows you an 8-letter code
            and <span className="code">{o}/device</span>.
          </li>
          <li>
            You type the code there and see the usual consent page. Only enter a code your own agent
            showed you.
          </li>
          <li>
            Meanwhile the agent asks <span className="code">/oauth/token</span> every 5 seconds. It
            hears <span className="code">authorization_pending</span> until you answer,{" "}
            <span className="code">slow_down</span> if it asks faster, then gets its tokens once, or{" "}
            <span className="code">access_denied</span>. The code lasts 10 minutes.
          </li>
        </ol>
      </section>

      <section className="max-w-[68ch] space-y-3">
        <h2 className="text-xl">How a purchase works</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Search with <span className="code">search_catalog</span> and pick variant ids (colour
            and size).
          </li>
          <li>
            <span className="code">create_checkout</span> with line items. The store prices
            everything; amounts are EUR minor units.
          </li>
          <li>
            If the status is <span className="code">ready_for_complete</span>, call{" "}
            <span className="code">complete_checkout</span> with the instrument from{" "}
            <span className="code">checkout.payment.instruments</span>. The merchant charges the
            saved card on Adyen TEST (ContAuth, UnscheduledCardOnFile).
          </li>
          <li>
            If the status is <span className="code">requires_escalation</span>, give the shopper{" "}
            <span className="code">continue_url</span>: they review and pay with Drop-in.
          </li>
          <li>
            <span className="code">get_order</span> reads the orders the agent placed, and needs a
            token with <span className="code">{HARD_GATES.join(", ")}</span>.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl">Scopes</h2>
        <ul className="space-y-2 text-sm">
          {ADVERTISED_SCOPES.map((s) => (
            <li key={s} className="rounded-xl border border-line p-3">
              <p>{SCOPES[s].label}</p>
              <p className="mt-1 text-xs text-muted">
                <span className="code break-all">{s}</span> · {CHANGES[SCOPES[s].changes]}
                {SCOPES[s].personalData ? " · personal data" : ""}
              </p>
            </li>
          ))}
        </ul>
        <p className="max-w-[68ch] text-sm text-muted">
          <span className="code">/mcp</span> needs a token. Over REST, the catalogue, carts and
          checkouts also work without one; a token that is sent must carry the operation&apos;s
          scope. The earlier names <span className="code">ucp:checkout</span> and{" "}
          <span className="code">ucp:orders</span> are still accepted.
        </p>
      </section>

      <section className="max-w-[68ch] space-y-3">
        <h2 className="text-xl">An agent in your browser</h2>
        <p className="text-sm text-muted">
          In a browser with WebMCP (Chrome&apos;s origin trial, or{" "}
          <span className="code break-all">chrome://flags/#enable-webmcp-testing</span>), the shop
          pages offer an agent five tools. They use your cart on this site, as the buttons do.
        </p>
        <ul className="space-y-1 text-sm">
          {WEBMCP_TOOLS.map(([name, what]) => (
            <li key={name}>
              <span className="code">{name}</span> <span className="text-muted">{what}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          No tool pays: you pay on the checkout page. Your account, consent, device and Back Office
          pages offer none. This does not replace <span className="code">/mcp</span>, which works as
          above.
        </p>
      </section>

      <section id="saved-card-handler" className="panel space-y-2 text-sm">
        <h2 className="text-xl">
          Payment handler <span className="code">saved_card</span>
        </h2>
        <p className="max-w-[68ch]">
          Declared under <span className="code">com.payments-playground.saved_card</span> in the UCP
          profile. Instruments are aliases of the card the shopper saved with Adyen (shopper
          reference <span className="code">ogaccountnew</span>); the raw Adyen token never leaves
          the merchant. It needs the <span className="code">ucp:pay</span> scope and a total within
          the grant&apos;s remaining spend limit. Adyen&apos;s own UCP tokenizer can replace it once
          the account has the role.
        </p>
      </section>
    </div>
  );
}
