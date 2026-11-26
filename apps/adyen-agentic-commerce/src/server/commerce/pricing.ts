// Spec: knowledge/components/adyen-agentic-commerce.md
// Prices from the catalogue only, totals with shipping, and the parsing of lines and buyers.
import { productById, variantById } from "../catalog/catalog";
import { get } from "../core/db";
import { isRecord, sha256 } from "../core/util";
import { DEFAULT_DELIVERY, type Delivery, deliveryFee, shippingText } from "../../lib/delivery";
import { type Buyer, err, type Line, MAX_LINES, MAX_QUANTITY } from "./model";

// Shipping follows the delivery the shopper chose; none chosen is standard, priced as before.
export function price(lines: Line[], delivery: Delivery = DEFAULT_DELIVERY) {
  const items = lines.map((line) => {
    const variant = variantById(line.variantId);
    if (!variant) throw err(400, "item_not_found", `Unknown item ${line.variantId}`);
    return { line, variant, amount: variant.price * line.quantity };
  });
  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  const fulfillment = deliveryFee(delivery.method, subtotal);
  return { items, subtotal, fulfillment, total: subtotal + fulfillment };
}

export function totals(lines: Line[], delivery: Delivery = DEFAULT_DELIVERY) {
  const p = price(lines, delivery);
  return [
    { type: "subtotal", display_text: "Subtotal", amount: p.subtotal },
    {
      type: "fulfillment",
      display_text: shippingText(delivery.method, p.fulfillment),
      amount: p.fulfillment,
    },
    { type: "total", display_text: "Total (VAT included)", amount: p.total },
  ];
}

export function parseLines(input: unknown, previous: Line[] = []): Line[] {
  if (!Array.isArray(input))
    throw err(400, "invalid_line_items", "line_items must be an array", "$.line_items");
  if (input.length > MAX_LINES)
    throw err(400, "too_many_line_items", `At most ${MAX_LINES} line items`, "$.line_items");
  const merged = new Map<string, Line>();
  input.forEach((raw, index) => {
    const path = `$.line_items[${index}]`;
    if (!isRecord(raw) || !isRecord(raw.item) || typeof raw.item.id !== "string") {
      throw err(400, "invalid_line_item", "Each line item needs item.id", path);
    }
    let id = raw.item.id;
    if (!variantById(id)) {
      const product = productById(id);
      const only = product && product.colours.length * product.sizes.length === 1;
      if (!product)
        throw err(
          400,
          "item_not_found",
          `No item ${id}. Use a variant id from the catalogue.`,
          `${path}.item.id`,
        );
      if (!only)
        throw err(
          400,
          "variant_required",
          `${id} has several variants; pass a variant id (colour and size).`,
          `${path}.item.id`,
        );
      id = `${product.id}-${product.colours[0]!.id}-one-size`;
    }
    const quantity = raw.quantity ?? 1;
    if (
      !Number.isInteger(quantity) ||
      (quantity as number) < 1 ||
      (quantity as number) > MAX_QUANTITY
    ) {
      throw err(
        400,
        "invalid_quantity",
        `quantity must be an integer from 1 to ${MAX_QUANTITY}`,
        `${path}.quantity`,
      );
    }
    const existing = merged.get(id);
    const lineId =
      typeof raw.id === "string" && previous.some((p) => p.id === raw.id)
        ? raw.id
        : (previous.find((p) => p.variantId === id)?.id ?? `li_${sha256(id).slice(0, 10)}`);
    merged.set(id, {
      id: existing?.id ?? lineId,
      variantId: id,
      quantity: Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + (quantity as number)),
    });
  });
  return [...merged.values()];
}

export function parseBuyer(input: unknown): Buyer | undefined {
  if (input === undefined) return undefined;
  if (!isRecord(input)) throw err(400, "invalid_buyer", "buyer must be an object", "$.buyer");
  const pick = (k: keyof Buyer, max: number) => {
    const v = input[k];
    if (v === undefined) return undefined;
    if (typeof v !== "string" || v.length > max)
      throw err(400, "invalid_buyer", `buyer.${k} is not valid`, `$.buyer.${k}`);
    return v.trim();
  };
  const email = pick("email", 254);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw err(400, "invalid_email", "buyer.email is not an email address", "$.buyer.email");
  return {
    first_name: pick("first_name", 80),
    last_name: pick("last_name", 80),
    email,
    phone_number: pick("phone_number", 32),
  };
}
