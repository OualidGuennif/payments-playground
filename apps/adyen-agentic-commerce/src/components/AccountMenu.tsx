// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { rememberAccount } from "@/lib/known";
import { maskEmail } from "@/lib/mask";
import { useHeaderMenu } from "./useHeaderMenu";

type Who = { email: string; name: string } | null;

export const ACCOUNT_LINKS = [
  ["/account#orders", "Orders"],
  ["/account#agents", "Agents"],
  ["/account#cards", "Payment methods"],
  ["/account#security", "Security"],
] as const;

const ITEM =
  "flex min-h-11 w-full cursor-pointer items-center rounded-xl px-3.5 py-2 text-left text-sm font-medium hover:bg-line/60";

// The header button and the phone menu both ask who is signed in: one request per page serves
// both. The layout stays static, so the answer comes from the browser after the page loads.
let asked: { path: string; who: Promise<Who> } | undefined;
function whoIs(path: string): Promise<Who> {
  if (asked?.path !== path) {
    asked = {
      path,
      who: api()
        .session.get()
        .then(({ data }) => {
          const who = data && "customer" in data ? (data.customer as Who) : null;
          // Once seen signed in, this browser greets the shopper back after the session ends.
          if (who) rememberAccount();
          return who;
        })
        // Unknown reads as signed out: the menu then offers Sign in, never someone's account.
        .catch(() => null),
    };
  }
  return asked.who;
}

// The header and the Personal Shopper both follow it.
export const SESSION_EVENT = "velune:auth-changed";

/** A sign-in without a page change (the Pay email modal): the header asks again. */
export function sessionChanged(): void {
  asked = undefined;
  window.dispatchEvent(new Event(SESSION_EVENT));
}

function useWho() {
  const pathname = usePathname() ?? "/";
  const [who, setWho] = useState<Who | undefined>();
  useEffect(() => {
    let live = true;
    const ask = () =>
      whoIs(pathname).then((w) => {
        if (live) setWho(w);
      });
    void ask();
    window.addEventListener(SESSION_EVENT, ask);
    return () => {
      live = false;
      window.removeEventListener(SESSION_EVENT, ask);
    };
  }, [pathname]);
  return { who, pathname };
}

const initialOf = (who: NonNullable<Who>) =>
  (who.name.trim() || who.email).charAt(0).toUpperCase() || "?";

// Signing in from the sign-in or sign-up page itself would come back to it.
const signInHref = (pathname: string) =>
  pathname.startsWith("/sign-") ? "/sign-in" : `/sign-in?next=${encodeURIComponent(pathname)}`;

async function signOut() {
  await api().session.delete();
  window.location.assign("/");
}

// On every width: "Sign in", or the customer's initial opening their account's sections.
export function AccountMenu() {
  const { who, pathname } = useWho();
  const menu = useRef<HTMLDetailsElement>(null);
  useHeaderMenu(menu, who);

  useEffect(() => {
    if (menu.current && pathname) menu.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      const el = menu.current;
      if (!el?.open) return;
      const outside = event instanceof MouseEvent && !el.contains(event.target as Node);
      const escaped = event instanceof KeyboardEvent && event.key === "Escape";
      if (outside || escaped) el.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  if (who === undefined) return <span aria-hidden="true" className="block h-11 w-16 shrink-0" />;
  if (!who) {
    return (
      <Link
        href={signInHref(pathname)}
        className="btn-ghost shrink-0 whitespace-nowrap px-2.5 py-1.5 text-[13px] sm:px-3.5 sm:text-sm"
      >
        Sign in
      </Link>
    );
  }
  return (
    <details ref={menu} className="relative shrink-0">
      <summary
        aria-label={`Account menu, signed in as ${who.name}`}
        className="grid size-11 cursor-pointer list-none place-items-center rounded-full bg-ink text-base font-semibold text-paper hover:opacity-85 [&::-webkit-details-marker]:hidden"
      >
        {initialOf(who)}
      </summary>
      <div className="absolute right-0 top-[calc(100%+8px)] z-30 velune-glass-card w-64 rounded-2xl border border-line p-2 shadow-lg">
        <p className="px-3.5 py-2 text-sm">
          <span className="block truncate font-medium">{who.name}</span>
          <span className="block truncate text-xs text-muted">{maskEmail(who.email)}</span>
        </p>
        <nav aria-label="Account" className="grid gap-0.5 border-y border-line py-1">
          {ACCOUNT_LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={ITEM}>
              {label}
            </Link>
          ))}
        </nav>
        <button type="button" className={`${ITEM} mt-1 text-bad`} onClick={signOut}>
          Sign out
        </button>
      </div>
    </details>
  );
}
