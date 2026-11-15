// Spec: knowledge/components/adyen-agentic-commerce.md
export const metadata = { title: "Terms and privacy" };

export default function Legal() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="space-y-2">
        <p className="eyebrow">Legal</p>
        <h1 className="text-3xl">Terms and privacy</h1>
        <p className="text-muted">
          Atelier Velune is a fictional store run as a payments demo. These pages exist because the
          UCP profile and agent consent screens link to them; they bind nobody.
        </p>
      </div>
      <section id="terms" className="space-y-3 text-sm">
        <h2 className="text-xl">Terms of service</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Every payment runs on the Adyen TEST environment. No real money moves, no goods ship and
            no order is a contract.
          </li>
          <li>
            Use only Adyen test cards. A real card number is refused by the TEST environment and
            must never be typed here.
          </li>
          <li>
            An AI agent acts only within the scopes and spend limit you grant on the consent screen.
            You can revoke a grant at any time on the Account page.
          </li>
          <li>
            Prices, stock and totals come from the store. An agent cannot set a price, and a payment
            is charged only once per checkout attempt.
          </li>
          <li>
            The demo can be reset or taken offline at any time; data may be deleted without notice.
          </li>
        </ul>
      </section>
      <section id="privacy" className="space-y-3 text-sm">
        <h2 className="text-xl">Privacy</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            The store keeps carts, checkouts, orders, agent grants and a short request trace in a
            local database on the server.
          </li>
          <li>
            Card details go straight to Adyen through Drop-in. The store keeps only Adyen&apos;s
            token reference and shows agents an alias, never the token.
          </li>
          <li>
            Tokens, codes, signatures and payment tokens are redacted from the trace shown in the
            Back Office.
          </li>
          <li>
            All shoppers share one demo identity; do not enter personal data you would not publish.
          </li>
        </ul>
      </section>
    </div>
  );
}
