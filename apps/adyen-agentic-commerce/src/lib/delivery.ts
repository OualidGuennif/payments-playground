// Spec: knowledge/components/adyen-agentic-commerce.md
// Delivery on a checkout: three methods, the demo's saved addresses and its pickup points. It holds
// no secret, so the checkout page and the Ask panel draw from it and the server prices from it.

export type DeliveryMethod = "standard" | "express" | "pickup";
export type Delivery = { method: DeliveryMethod; placeId: string };
export type Place = { id: string; name: string; street: string; postalCode: string; city: string };

export const FREE_SHIPPING_FROM = 10000;
export const STANDARD_FEE = 495;
export const EXPRESS_FEE = 995;

export const METHODS: ReadonlyArray<{ id: DeliveryMethod; label: string; timing: string }> = [
  { id: "standard", label: "Standard", timing: "3 to 5 working days" },
  { id: "express", label: "Express", timing: "Next working day" },
  { id: "pickup", label: "Pickup point", timing: "3 to 4 working days" },
];

// Ordinary French streets, for a TEST store where nothing ships: the shopper picks, never types.
export const ADDRESSES: ReadonlyArray<Place> = [
  { id: "home", name: "Home", street: "7 avenue Daumesnil", postalCode: "75012", city: "Paris" },
  {
    id: "office",
    name: "Office",
    street: "25 boulevard Haussmann",
    postalCode: "75009",
    city: "Paris",
  },
  {
    id: "family",
    name: "Family",
    street: "8 rue de la République",
    postalCode: "69002",
    city: "Lyon",
  },
  {
    id: "holiday",
    name: "Holiday flat",
    street: "14 quai des Chartrons",
    postalCode: "33000",
    city: "Bordeaux",
  },
];

export const PICKUP_POINTS: ReadonlyArray<Place> = [
  {
    id: "relay-daumesnil",
    name: "Relais Daumesnil (newsagent)",
    street: "40 avenue Daumesnil",
    postalCode: "75012",
    city: "Paris",
  },
  {
    id: "relay-roquette",
    name: "Relais Roquette (tobacconist)",
    street: "2 rue de la Roquette",
    postalCode: "75011",
    city: "Paris",
  },
  {
    id: "relay-depart",
    name: "Relais Montparnasse (bookshop)",
    street: "10 rue du Départ",
    postalCode: "75014",
    city: "Paris",
  },
  {
    id: "relay-barre",
    name: "Relais Bellecour (grocer)",
    street: "3 rue de la Barre",
    postalCode: "69002",
    city: "Lyon",
  },
  {
    id: "relay-catherine",
    name: "Relais Sainte-Catherine (newsagent)",
    street: "50 rue Sainte-Catherine",
    postalCode: "33000",
    city: "Bordeaux",
  },
];

export const placesFor = (method: DeliveryMethod): ReadonlyArray<Place> =>
  method === "pickup" ? PICKUP_POINTS : ADDRESSES;

// A checkout nobody chose for goes by standard delivery to the first address, priced as before.
export const DEFAULT_DELIVERY: Delivery = { method: "standard", placeId: ADDRESSES[0]!.id };

export function deliveryFee(method: DeliveryMethod, subtotal: number): number {
  if (subtotal === 0 || method === "pickup") return 0;
  if (method === "express") return EXPRESS_FEE;
  return subtotal >= FREE_SHIPPING_FROM ? 0 : STANDARD_FEE;
}

export function shippingText(method: DeliveryMethod, fee: number): string {
  if (method === "express") return "Express shipping";
  if (method === "pickup") return "Pickup point";
  return fee ? "Standard shipping" : "Free shipping";
}

// Only a known method with one of its own places: anything else is no choice at all.
export function parseDelivery(input: unknown): Delivery | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const { method, placeId } = input as Record<string, unknown>;
  const known = METHODS.find((m) => m.id === method)?.id;
  if (!known || typeof placeId !== "string") return undefined;
  return placesFor(known).some((p) => p.id === placeId) ? { method: known, placeId } : undefined;
}

export const placeOf = (delivery: Delivery): Place =>
  placesFor(delivery.method).find((p) => p.id === delivery.placeId) ??
  placesFor(delivery.method)[0]!;

// Switching method keeps the place when it belongs to the new method, or takes its first one.
export function withMethod(delivery: Delivery, method: DeliveryMethod): Delivery {
  const places = placesFor(method);
  const kept = places.some((p) => p.id === delivery.placeId);
  return { method, placeId: kept ? delivery.placeId : places[0]!.id };
}

export const placeText = (place: Place) =>
  `${place.name}, ${place.street}, ${place.postalCode} ${place.city}`;
