// A single shopperReference shared by every /sessions call across the
// playground apps, rotating weekly (UTC) so TEST data doesn't accumulate
// under one identity forever but still correlates within a week of testing.
// The boundary lands on the Sunday-night/Monday-morning UTC transition.
export function weeklyShopperReference(now = new Date()): string {
  const day = now.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
  );
  const anchor = monday.toISOString().slice(0, 10);
  return `playground-shopper-${anchor}`;
}
