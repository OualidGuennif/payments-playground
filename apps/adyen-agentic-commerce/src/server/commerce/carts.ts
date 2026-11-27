// Spec: knowledge/components/adyen-agentic-commerce.md
// Carts: create, load for their owner, update and cancel.
import { get, put } from "../core/db";
import type { Auth } from "../oauth/oauth";
import { newId } from "../core/util";
import { type Cart, err, now } from "./model";
import { parseBuyer, parseLines } from "./pricing";

export function createCart(body: Record<string, unknown>, auth?: Auth): Cart {
  const lines = parseLines(body.line_items);
  const cart: Cart = {
    id: newId("cart"),
    lines,
    buyer: parseBuyer(body.buyer),
    status: "active",
    clientId: auth?.token.clientId,
    customerId: auth?.grant.customerId,
    createdAt: now(),
    updatedAt: now(),
  };
  return put("carts", cart.id, cart);
}

// A record made through a token is the same client's for the same account, and no one else's.
export function ownedBy(record: { clientId?: string; customerId?: string }, auth?: Auth): boolean {
  if (!record.clientId) return true;
  return record.clientId === auth?.token.clientId && record.customerId === auth.grant.customerId;
}

export function loadCart(id: string, auth?: Auth): Cart {
  const cart = get<Cart>("carts", id);
  if (!cart || !ownedBy(cart, auth)) throw err(404, "not_found", "Cart not found");
  return cart;
}

export function updateCart(cart: Cart, body: Record<string, unknown>): Cart {
  if (cart.status !== "active") throw err(409, "cart_canceled", "This cart was canceled");
  const lines =
    body.line_items === undefined ? cart.lines : parseLines(body.line_items, cart.lines);
  return put("carts", cart.id, {
    ...cart,
    lines,
    buyer: parseBuyer(body.buyer) ?? cart.buyer,
    updatedAt: now(),
  });
}

export function cancelCart(cart: Cart): Cart {
  return put("carts", cart.id, { ...cart, status: "canceled", updatedAt: now() });
}
