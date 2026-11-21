import { colors, grid, type Pair, type State, type Side } from "./game";
const paths: Record<string, string> = {
  solo: '<rect x="4" y="7" width="16" height="12" rx="4"/><path d="M12 7V4m-2 0h4M8 12h.01M16 12h.01m-6 3h4"/>',
  local:
    '<circle cx="9" cy="8" r="3"/><path d="M3 19v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m1 2a5 5 0 0 1 4 5"/>',
  online:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  sound:
    '<path d="M4 9h4l5-4v14l-5-4H4zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6m0-6-5 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4 2.4c-1.5.8-1.5 1.6-1.5 2.4m0 2.4h.01"/>',
  install:
    '<path d="M12 3v11m-4-4 4 4 4-4M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  start:
    '<path fill="currentColor" stroke="none" d="M6 4.5c0-1 1.1-1.6 1.9-1l13 8c.8.4.8 1.5 0 2l-13 8c-.8.6-1.9 0-1.9-1z"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 4v16M4 12h16"/>',
  trophy:
    '<path d="M7 3h10v6a5 5 0 0 1-10 0zM7 5H3v2a4 4 0 0 0 5 4m9-6h4v2a4 4 0 0 1-5 4m-4 3v5m-5 2h10"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  edit: '<path d="m4 15 10-10 5 5L9 20l-6 1zM12 7l5 5"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5m-9 5v10"/>',
};
export function icon(k: string) {
  return (
    '<svg aria-hidden="true" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    paths[k] +
    "</svg>"
  );
}
export function esc(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function boardHtml(
  s: State,
  players: Pair,
  locked: boolean,
  last?: string,
) {
  const g = grid(s.board),
    { columns: w, rows: h } = s.board;
  const coords = (x: number, y: number) => "--x:" + x + ";--y:" + y + ";";
  const ownerStyle = (side: Side | undefined) =>
    side ? "--ink:" + colors[players[side].color] + ";" : "";
  const boxes = Object.entries(s.boxes)
    .map(([key, side]) => {
      const [y, x] = key.split("_").map(Number);
      return (
        '<div class="tile" style="' +
        coords(x, y) +
        ownerStyle(side) +
        '">' +
        esc(players[side].initials) +
        "</div>"
      );
    })
    .join("");
  const lines = g.edges
    .map((e) => {
      const side = s.lines[e.key],
        label =
          (e.vertical ? "Vertical" : "Horizontal") +
          " line, row " +
          (e.row + 1) +
          ", column " +
          (e.col + 1);
      return (
        '<button class="edge ' +
        (e.vertical ? "vertical" : "horizontal") +
        (side ? " owned" : "") +
        (e.key === last ? " latest" : "") +
        '" data-edge="' +
        e.key +
        '" aria-label="' +
        label +
        (side ? ", " + esc(players[side].initials) : "") +
        '" ' +
        (side || locked ? "disabled" : "") +
        ' style="' +
        coords(e.col, e.row) +
        ownerStyle(side) +
        '"></button>'
      );
    })
    .join("");
  let dots = "";
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++)
      dots += '<i class="dot" style="' + coords(x, y) + '"></i>';
  return (
    '<div class="board-shell" style="--w:' +
    w +
    ";--h:" +
    h +
    ";--turn:" +
    colors[players[s.currentPlayer].color] +
    '"><div class="board" role="group" aria-label="Game board">' +
    boxes +
    lines +
    dots +
    "</div></div>"
  );
}
export const logo =
  '<span class="brand-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
export function frame(title: string, body: string) {
  return (
    '<div class="dialog-head"><h2 id="dialog-title">' +
    title +
    '</h2><button class="round" data-action="close" aria-label="Close">' +
    icon("close") +
    "</button></div>" +
    body
  );
}
export function fallbackArt() {
  const tiles = Array.from(
    { length: 16 },
    (_, i) =>
      '<i class="' +
      ([4, 5].includes(i)
        ? "purple"
        : [10, 11, 14].includes(i)
          ? "coral"
          : "") +
      '"></i>',
  ).join("");
  return '<div class="fallback-board">' + tiles + "</div>";
}
