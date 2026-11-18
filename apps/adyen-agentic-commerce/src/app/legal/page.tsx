// Spec: knowledge/components/adyen-agentic-commerce.md
export const metadata = { title: "Terms and privacy" };

export default function Legal() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="max-w-[68ch] space-y-2">
        <h1 className="text-3xl">Terms and privacy</h1>
        <p className="text-muted">
          Atelier Velune is a made-up store that demonstrates payments. The store's agent profile
          and consent screen link here, but nothing on this page binds anyone.
        </p>
      </div>
      <section id="terms" className="max-w-[68ch] space-y-3 text-sm">
        <h2 className="text-xl">Terms of service</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Every payment runs on the Adyen TEST environment. No real money moves, no goods ship and
            no order is a contract.
          </li>
          <li>
            Use only Adyen test cards. Adyen TEST refuses a real card number, and you should never
            type one here.
          </li>
          <li>
            An AI agent can do only what you allowed on the consent screen and spend only up to the
            limit you set. You can change the limit or disconnect the agent on your account page.
          </li>
          <li>
            Prices, stock and totals come from the store. An agent cannot set a price, and each
            checkout attempt is charged at most once.
          </li>
          <li>
            The demo can be reset or taken offline at any time, and its data deleted without notice.
          </li>
        </ul>
      </section>
      <section id="privacy" className="max-w-[68ch] space-y-3 text-sm">
        <h2 className="text-xl">Privacy</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            The store keeps accounts, carts, checkouts, orders, connected agents and a short log of
            requests in a database on its server.
          </li>
          <li>
            Card details you type go straight to Adyen through Drop-in. The store keeps only
            Adyen&apos;s reference to the saved card and shows agents a short alias instead. A card
            an agent sends is passed to Adyen once and kept nowhere.
          </li>
          <li>
            The Back Office log hides passwords, sign-in codes, tokens, signatures and card numbers,
            and masks every email address.
          </li>
          <li>
            Anyone who can open this demo can read its Back Office, so do not enter personal data
            you would not publish.
          </li>
        </ul>
      </section>
    </div>
  );
}
