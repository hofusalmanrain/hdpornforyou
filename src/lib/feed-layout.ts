export type FeedAdKind = "native" | "outstream" | "banner";

/**
 * Seat in-feed ads following admin N with minimum spacing.
 *
 * Natives and banners are full-width on every layout (1/2/3-col), so they
 * seat exactly at their trigger subject only to minimum spacing and
 * exclusivity; odd video runs left around them on 2-col layouts are
 * backfilled by the grid's dense flow pulling later videos up — that is why
 * grids stay `grid-flow-row-dense`. Outstreams are 2-span on lg, so they
 * additionally need a fresh 3-col row (tracked via colPos, reset by every
 * full row) plus a follower video in DOM order to fill lg's 3rd column.
 * Seats hold at most ONE ad each and keep trigger order, so the loop always
 * reads ads separated by videos — never stacked, never adjacent without
 * videos.
 *
 * Minimum spacing: a seat must be at least `minGap` videos away from every
 * already-seated ad (admin N from feed injection; higher accepted when
 * alignment requires it).
 *
 * Triggers come from pickFeedSlot (frequency/settings/count logic is
 * untouched — ads fire in order, never earlier than earned). Seats that can
 * never be filled cleanly are dropped rather than stranded with a hole or
 * stacked onto another ad.
 *
 * Returns map: afterVideoIndex -> kinds to render after that video.
 */
export function planFeedAdSlots(
  count: number,
  slotAt: (i: number) => FeedAdKind | null,
  minGap: number,
): Map<number, FeedAdKind[]> {
  const plan = new Map<number, FeedAdKind[]>();
  if (count <= 0) return plan;
  const gap = Math.max(1, Math.trunc(minGap) || 1);
  const put = (j: number, k: FeedAdKind) => {
    const arr = plan.get(j);
    if (arr) arr.push(k);
    else plan.set(j, [k]);
  };
  // Virtual seat before the list: first ad needs >= minGap videos from top.
  const placed: number[] = [-1];
  const spaced = (j: number): boolean => placed.every((s) => Math.abs(j - s) >= gap);
  const isFree = (j: number) => (plan.get(j) ?? []).length === 0;
  // Collect triggers in firing order.
  const triggers: Array<{ i: number; k: FeedAdKind; seated: boolean }> = [];
  for (let i = 0; i < count; i++) {
    const s = slotAt(i);
    if (s) triggers.push({ i, k: s, seated: false });
  }
  const queue: Array<{ i: number; k: FeedAdKind; seated: boolean }> = [];
  let colPos = 0; // videos placed mod 3 since last full-row boundary
  const colPosAfter: number[] = new Array(count).fill(0);
  const flushable = (k: FeedAdKind, afterVideo: number): boolean => {
    // Native owns a full row on every layout: no row-start needed.
    if (k === "outstream") {
      if (colPos !== 0) return false;
      if (afterVideo >= count - 1) return false; // needs follower
    }
    if (!spaced(afterVideo)) return false;
    return true;
  };
  const seat = (t: { i: number; k: FeedAdKind; seated: boolean }, j: number) => {
    t.seated = true;
    put(j, t.k);
    placed.push(j);
    // Native and banner both own a full row on every layout: tiling restarts
    // here, so later outstream row-start checks stay sound. (Outstream seats
    // leave colPos alone; their follower video advances it normally.)
    if (t.k !== "outstream") colPos = 0;
  };
  const tryFlush = (afterVideo: number) => {
    if (!queue.length) return;
    const head = queue[0];
    if (!flushable(head.k, afterVideo)) return;
    queue.shift();
    seat(head, afterVideo);
  };
  for (let i = 0; i < count; i++) {
    colPos = (colPos + 1) % 3; // video i renders
    const t = triggers.find((x) => x.i === i);
    if (t) queue.push(t);
    tryFlush(i);
    colPosAfter[i] = colPos;
  }
  // Leftovers: outstreams first (pickier), then natives. Nearest free seat
  // to the trigger (outward search) satisfying row-start (outstream only, via
  // recorded colPos), follower, spacing and exclusivity. Unseatable leftovers
  // are dropped, never stacked or holed.
  const nearestSeat = (t: { i: number; k: FeedAdKind }): number | null => {
    for (let d = 0; d < count; d++) {
      for (const j of [t.i + d, t.i - d]) {
        if (j < 0 || j >= count) continue;
        if (!isFree(j)) continue;
        if (t.k === "outstream") {
          if (colPosAfter[j] !== 0) continue;
          if (j >= count - 1) continue;
        }
        if (!spaced(j)) continue;
        return j;
      }
    }
    return null;
  };
  for (const t of triggers) {
    if (t.seated || t.k !== "outstream") continue;
    const j = nearestSeat(t);
    if (j === null) continue; // degenerate: drop instead of holing/stacking
    seat(t, j);
  }
  for (const t of triggers) {
    if (t.seated) continue;
    const j = nearestSeat(t);
    if (j === null) continue; // degenerate: drop instead of holing/stacking
    seat(t, j);
  }
  return plan;
}
