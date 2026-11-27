"use client";
// Spec: knowledge/components/ask-agent.md
// The bag's delivery, chosen in the panel itself: one line (method, price, place) with Edit, which
// unfolds standard, express or a pickup point from the store's own lists, preselected. It goes to
// the checkout's own route, never through the assistant, and the widget then shows the new total.
import { useEffect, useState } from "react";
import { DeliveryPicker } from "@/components/DeliveryPicker";
import { api } from "@/lib/client";
import { type Delivery, METHODS, placesFor, placeText } from "@/lib/delivery";
import { money } from "@/lib/money";
import { shopperWords } from "@/lib/shopper-words";
import type { checkoutView } from "@/server/api";
import { askCall } from "./askClient";
import { BAG_URI, type Fed } from "./askLogic";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Shown = { delivery: Delivery; subtotal: number; fulfillment: number };

// Eden narrows this route's answer to never once the error branch is ruled out; the route returns
// checkoutView's shape, so the read goes through that type.
function shownOf(data: unknown): Shown | undefined {
  if (!record(data) || "error" in data) return undefined;
  const view = data as ReturnType<typeof checkoutView>;
  return { delivery: view.delivery, subtotal: view.subtotal, fulfillment: view.fulfillment };
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
  const [editing, setEditing] = useState(false);

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

  const method = METHODS.find((m) => m.id === shown.delivery.method);
  const place = placesFor(shown.delivery.method).find((p) => p.id === shown.delivery.placeId);
  return (
    <section className="space-y-3 p-3.5 text-sm" aria-label="Delivery">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate">
          <span className="text-muted">Delivery: </span>
          {method?.label ?? "Standard"} · {shown.fulfillment ? money(shown.fulfillment) : "Free"}
          {place ? <span className="text-muted"> · {placeText(place)}</span> : null}
        </p>
        <button
          type="button"
          className="min-h-9 shrink-0 cursor-pointer rounded-full px-3 font-medium underline disabled:opacity-40"
          aria-expanded={editing}
          disabled={busy}
          onClick={() => setEditing(!editing)}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      {editing ? (
        <DeliveryPicker
          value={shown.delivery}
          subtotal={shown.subtotal}
          disabled={busy}
          onChange={(next) => void choose(next)}
        />
      ) : null}
      {note ? (
        <p role="alert" className="mt-2 text-bad">
          {note}
        </p>
      ) : null}
    </section>
  );
}
