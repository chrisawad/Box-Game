import { grid, type State } from "./game";

// With few lines left, solve the extra-turn scoring game exactly. A mask is
// sufficient: past ownership cannot affect the value of the remaining boxes.
function solveEndgame(keys: string[], state: State): string {
  const { cells, byKey } = grid(state.board);
  const bits = new Map(keys.map((k, i) => [k, 1 << i]));
  const masks = keys.map((k) =>
    byKey
      .get(k)!
      .adjacent.map((c) =>
        cells[c].reduce((m, e) => m | (bits.get(e) ?? 0), 0),
      ),
  );
  const memo = new Int16Array(1 << keys.length).fill(-999);
  memo[0] = 0;
  let choice = 0;
  const full = memo.length - 1;
  function best(left: number): number {
    if (memo[left] !== -999) return memo[left];
    let value = -999;
    for (let options = left; options; options &= options - 1) {
      const bit = options & -options,
        i = 31 - Math.clz32(bit);
      const remaining = left ^ bit;
      const won = masks[i].filter((m) => (m & remaining) === 0).length;
      const reply = best(remaining);
      const result = won ? won + reply : -reply;
      if (result > value) {
        value = result;
        if (left === full) choice = i;
      }
    }
    return (memo[left] = value);
  }
  best(full);
  return keys[choice];
}
export function computerMove(
  state: State,
  random = Math.random,
): string | undefined {
  const { edges, cells, byKey } = grid(state.board);
  const open = edges.filter((e) => !state.lines[e.key]);
  if (!open.length) return undefined;
  if (open.length <= 16)
    return solveEndgame(
      open.map((e) => e.key),
      state,
    );
  const missing = new Map(
    Object.entries(cells).map(([c, keys]) => [
      c,
      keys.filter((k) => !state.lines[k]),
    ]),
  );
  const pick = <T>(pool: T[]) => pool[Math.floor(random() * pool.length)];
  const capture = open.filter((e) =>
    e.adjacent.some((c) => missing.get(c)!.length === 1),
  );
  if (capture.length) {
    const doubles = capture.filter(
      (e) =>
        e.adjacent.every((c) => missing.get(c)!.length === 1) &&
        e.adjacent.length === 2,
    );
    return pick(doubles.length ? doubles : capture).key;
  }
  const safe = open.filter((e) =>
    e.adjacent.every((c) => missing.get(c)!.length > 2),
  );
  if (safe.length) return pick(safe).key;
  // Every move opens a chain. Follow forced captures to measure its full cost.
  let least = Infinity;
  let choices: string[] = [];
  for (const edge of open) {
    const drawn = new Set<string>(),
      claimed = new Set<string>(),
      pending = [edge.key];
    while (pending.length) {
      const key = pending.pop()!;
      if (drawn.has(key)) continue;
      drawn.add(key);
      for (const cell of byKey.get(key)!.adjacent) {
        const free = missing.get(cell)!.filter((k) => !drawn.has(k));
        if (free.length === 1) pending.push(free[0]);
        if (!free.length) claimed.add(cell);
      }
    }
    if (claimed.size < least) {
      least = claimed.size;
      choices = [];
    }
    if (claimed.size === least) choices.push(edge.key);
  }
  return pick(choices);
}
