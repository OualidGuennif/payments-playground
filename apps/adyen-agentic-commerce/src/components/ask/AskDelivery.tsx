"use client";
// Spec: knowledge/components/ask-agent.md
// The bag's delivery, chosen in the panel itself: standard, express or a pickup point from the
// store's own lists, preselected. It goes to the checkout's own route, never through the
// assistant, and the widget then shows the store's new total.
import { useEffect, useState } from "react";
import { DeliveryPicker } from "@/components/DeliveryPicker";
import { api } from "@/lib/client";
import type { Delivery } from "@/lib/delivery";
import { shopperWords } from "@/lib/shopper-words";
import type { checkoutView } from "@/server/api";
import { askCall } from "./askClient";
import { BAG_URI, type Fed } from "./askLogic";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Shown = { delivery: Delivery; subtotal: number };

// Eden narrows this route's answer to never once the error branch is ruled out; the route returns
// checkoutView's shape, so the read goes through that type.
function shownOf(data: unknown): Shown | undefined {
  if (!record(data) || "error" in data) return undefined;
  const view = data as ReturnType<typeof checkoutView>;
  return { delivery: view.delivery, subtotal: view.subtotal };
}

export function AskDelivery({
  checkoutId,
  onResult,
}: {
  checkoutId: string;
  onResult: (fed: Fed) => void;
}) {
  const [shown, setShown] = useState<Shown>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  useEffect(() => {
    let live = true;
    void api()
      .checkouts({ id: checkoutId })
      .get()
      .then(({ data }) => {
        const read = shownOf(data);
        if (live && read) setShown(read);
      });
    return () => {
      live = false;
    };
  }, [checkoutId]);

  // A checkout the page cannot read (another account's) shows no choice at all.
  if (!shown) return null;

  const choose = async (next: Delivery) => {
    const before = shown;
    setShown({ ...shown, delivery: next });
    setBusy(true);
    setNote(undefined);
    const { data, error } = await api().checkouts({ id: checkoutId }).delivery.post(next);
    const saved = error ? undefined : shownOf(data);
    if (!saved) {
      setBusy(false);
      setShown(before);
      const value = error?.value as { error?: unknown } | undefined;
      setNote(typeof value?.error === "string" ? value.error : shopperWords("invalid_delivery"));
      return;
    }
    setShown(saved);
    const fresh = await askCall<{ result: unknown }>("/widget", {
      name: "get_checkout",
      arguments: { id: checkoutId },
    });
    setBusy(false);
    const result = fresh.data?.result;
    if (record(result) && result.structuredContent !== undefined)
      onResult({
        resourceUri: BAG_URI,
        structuredContent: result.structuredContent,
        at: Date.now(),
      });
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-3.5 text-sm">
      <DeliveryPicker
        value={shown.delivery}
        subtotal={shown.subtotal}
        disabled={busy}
        onChange={(next) => void choose(next)}
      />
      {note ? (
        <p role="alert" className="mt-2 text-bad">
          {note}
        </p>
      ) : null}
    </section>
  );
}
