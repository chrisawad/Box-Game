import { describe, expect, it } from "vitest";
import {
  finished,
  fresh,
  grid,
  initials,
  place,
  score,
  validState,
  type State,
} from "../src/game";
import { computerMove } from "../src/computer";
const small = () => fresh({ columns: 2, rows: 2 });
describe("dots and boxes", () => {
  it("matches the 4 by 4 Android board and all rectangular sizes", () => {
    for (let w = 2; w <= 10; w++)
      for (let h = 2; h <= 10; h++) {
        const state = fresh({ columns: w, rows: h }),
          g = grid(state.board);
        expect(g.edges).toHaveLength(2 * w * h + w + h);
        const final = g.edges.reduce((s, e) => place(s, e.key), state);
        expect(finished(final) && validState(final)).toBe(true);
        expect(score(final, "Player1") + score(final, "Player2")).toBe(w * h);
      }
  });
  it("one shared side claims both adjacent boxes and keeps the turn", () => {
    let s = small();
    for (const k of ["h_0_0", "h_0_1", "h_1_0", "h_1_1", "v_0_0", "v_0_2"])
      s = place(s, k);
    const n = place(s, "v_0_1");
    expect(n.currentPlayer).toBe(s.currentPlayer);
    expect(score(n, s.currentPlayer)).toBe(2);
    expect(place(n, "v_0_1")).toBe(n);
    expect(place(n, "v_20_20")).toBe(n);
  });
  it("normalizes initials consistently with the mobile game", () => {
    expect(initials(" a?b9w")).toBe("AB9");
  });
});
describe("computer", () => {
  it("avoids giving away a third side when a safe move exists", () => {
    const s = ["h_0_0", "v_0_0"].reduce(place, fresh({ columns: 4, rows: 4 }));
    for (let i = 0; i < 50; i++) {
      const k = computerMove(s)!;
      expect(["h_1_0", "v_0_1"]).not.toContain(k);
    }
  });
  it("plays an optimal 2 by 2 game against every possible opponent reply", () => {
    // An independent minimax directly compares final box counts, including extra turns.
    const memo = new Map<string, number>();
    function oracle(s: State): number {
      if (finished(s)) return score(s, "Player2") - score(s, "Player1");
      const mask =
        grid(s.board)
          .edges.map((e) => (s.lines[e.key] ? "1" : "0"))
          .join("") +
        s.currentPlayer +
        ":" +
        score(s, "Player2") +
        ":" +
        score(s, "Player1");
      if (memo.has(mask)) return memo.get(mask)!;
      const values = grid(s.board)
        .edges.filter((e) => !s.lines[e.key])
        .map((e) => oracle(place(s, e.key)));
      const v =
        s.currentPlayer === "Player2"
          ? Math.max(...values)
          : Math.min(...values);
      memo.set(mask, v);
      return v;
    }
    const checked = new Set<string>();
    function check(s: State) {
      if (finished(s)) return;
      const id =
        grid(s.board)
          .edges.map((e) => (s.lines[e.key] ? "1" : "0"))
          .join("") + s.currentPlayer;
      if (checked.has(id)) return;
      checked.add(id);
      if (s.currentPlayer === "Player2") {
        const n = place(s, computerMove(s)!);
        expect(oracle(n)).toBe(oracle(s));
        check(n);
      } else
        for (const e of grid(s.board).edges)
          if (!s.lines[e.key]) check(place(s, e.key));
    }
    check(small());
    expect(checked.size).toBeGreaterThan(100);
  });
  it("outplays a random player on default boards from either seat", () => {
    let seed = 45;
    const rng = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    let wins = 0;
    for (let i = 0; i < 24; i++) {
      let s = fresh({ columns: 4, rows: 4 });
      const cpu = i % 2 ? "Player1" : "Player2";
      while (!finished(s)) {
        const free = grid(s.board).edges.filter((e) => !s.lines[e.key]);
        s = place(
          s,
          s.currentPlayer === cpu
            ? computerMove(s, rng)!
            : free[Math.floor(rng() * free.length)].key,
        );
      }
      if (score(s, cpu) > 8) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(20);
  });
});
