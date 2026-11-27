// Spec: knowledge/components/agentic-storefront.md
// Transitions: a template mounts again on every navigation, so each page enters with a short fade
// and rise while the layout's header and the Personal Shopper stay as they are.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
