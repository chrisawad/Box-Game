export const colors = {
  Red: "#ff7181",
  Orange: "#ff9968",
  Amber: "#f3c563",
  Lime: "#b4d970",
  Green: "#6cd893",
  Teal: "#62d1b8",
  Cyan: "#63d7f0",
  Blue: "#75a8ff",
  Indigo: "#9192ff",
  Purple: "#b38af2",
  Pink: "#f28cc8",
  Slate: "#abb9cf",
};
export type Color = keyof typeof colors;
export type Side = "Player1" | "Player2";
export type Mode = "solo" | "local" | "online";
export type Player = { initials: string; color: Color };
export type Pair = Record<Side, Player>;
export type Size = { columns: number; rows: number };
export type State = {
  board: Size;
  currentPlayer: Side;
  lines: Record<string, Side>;
  boxes: Record<string, Side>;
};
export type Edge = {
  key: string;
  row: number;
  col: number;
  vertical: boolean;
  adjacent: string[];
};
export function other(side: Side): Side {
  return side === "Player1" ? "Player2" : "Player1";
}
export function initials(value: string) {
  return Array.from(
    value
      .normalize()
      .replace(/[^\p{L}\p{N}]/gu, "")
      .toUpperCase(),
  )
    .slice(0, 3)
    .join("");
}
export function validSize(board: Size) {
  return [board?.columns, board?.rows].every(
    (n) => Number.isInteger(n) && n >= 2 && n <= 10,
  );
}
export function fresh(board: Size): State {
  if (!validSize(board))
    throw Error("Choose a board between 2 and 10 boxes on each side.");
  return { board, currentPlayer: "Player1", lines: {}, boxes: {} };
}
const grids = new Map<string, ReturnType<typeof makeGrid>>();
function makeGrid({ columns, rows }: Size) {
  const edges: Edge[] = [];
  const cells: Record<string, string[]> = {};
  const byKey = new Map<string, Edge>();
  for (const vertical of [false, true]) {
    for (let row = 0; row < rows + Number(!vertical); row++) {
      for (let col = 0; col < columns + Number(vertical); col++) {
        const key = (vertical ? "v" : "h") + "_" + row + "_" + col;
        const neighbors = vertical
          ? [
              [row, col - 1],
              [row, col],
            ]
          : [
              [row - 1, col],
              [row, col],
            ];
        const adjacent = neighbors
          .filter(([r, c]) => r >= 0 && r < rows && c >= 0 && c < columns)
          .map(([r, c]) => r + "_" + c);
        const edge = { key, row, col, vertical, adjacent };
        edges.push(edge);
        byKey.set(key, edge);
        for (const id of adjacent) (cells[id] ??= []).push(key);
      }
    }
  }
  return { edges, cells, byKey };
}
export function grid(size: Size) {
  const key = size.columns + "x" + size.rows;
  if (!grids.has(key)) grids.set(key, makeGrid(size));
  return grids.get(key)!;
}
export function score(state: State, side: Side) {
  return Object.values(state.boxes).filter((s) => s === side).length;
}
export function finished(state: State) {
  return (
    Object.keys(state.boxes).length === state.board.columns * state.board.rows
  );
}
export function place(state: State, key: string): State {
  const { cells, byKey } = grid(state.board);
  const edge = byKey.get(key);
  if (!edge || state.lines[key]) return state;
  const lines = { ...state.lines, [key]: state.currentPlayer };
  const boxes = { ...state.boxes };
  let captures = 0;
  for (const cell of edge.adjacent) {
    if (cells[cell].every((k) => lines[k])) {
      boxes[cell] = state.currentPlayer;
      captures++;
    }
  }
  return {
    board: state.board,
    lines,
    boxes,
    currentPlayer: captures ? state.currentPlayer : other(state.currentPlayer),
  };
}
export function validState(s: State) {
  if (
    !s ||
    !validSize(s.board) ||
    !["Player1", "Player2"].includes(s.currentPlayer) ||
    !s.lines ||
    !s.boxes
  )
    return false;
  const g = grid(s.board);
  const owned = (v: unknown) => v === "Player1" || v === "Player2";
  return (
    Object.entries(s.lines).every(([k, v]) => g.byKey.has(k) && owned(v)) &&
    Object.entries(s.boxes).every(
      ([k, v]) => Object.hasOwn(g.cells, k) && owned(v),
    ) &&
    Object.entries(g.cells).every(
      ([k, edges]) => edges.every((e) => s.lines[e]) === Boolean(s.boxes[k]),
    )
  );
}
export function validPlayer(p: Player) {
  return (
    !!p &&
    typeof p.initials === "string" &&
    !!p.initials &&
    initials(p.initials) === p.initials &&
    Object.hasOwn(colors, p.color)
  );
}
