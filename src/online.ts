import { createAuthoritativeMultiplayer, type MatchView } from "./multiplayer/authoritative";
import { colors, finished, fresh, place, score, validState, type Color, type Player, type Size, type State } from "./game";
import { roomStore } from "./room-storage";

export type OnlineView = MatchView<Player, State>;

export const { enter } = createAuthoritativeMultiplayer<Player, Size, State, string>({
  store: roomStore,
  protocol: "box-game-v1",
  moveField: "edge",
  relayUrl: import.meta.env.VITE_TURN_WORKER_URL,
  peerOptions: import.meta.env.VITE_PEER_HOST ? {
    host: import.meta.env.VITE_PEER_HOST,
    port: Number(import.meta.env.VITE_PEER_PORT || 443),
    path: import.meta.env.VITE_PEER_PATH || "/",
    secure: import.meta.env.VITE_PEER_SECURE !== "false",
  } : undefined,
  queueKey: size => size.columns + "x" + size.rows,
  settings: state => state.board,
  initial: fresh,
  isState: (value): value is State => validState(value as State),
  isMove: (value): value is string => typeof value === "string",
  apply: (state, edge, seat) => seat === state.currentPlayer ? place(state, edge) : state,
  revision: state => Object.keys(state.lines).length,
  finished,
  acceptGuest(host, guest) {
    const color = host.color === guest.color
      ? (Object.keys(colors) as Color[]).find(option => option !== host.color)!
      : guest.color;
    return { initials: guest.initials, color };
  },
  legacyRematchSeat(state, round) {
    const diff = score(state, "Player1") - score(state, "Player2");
    return diff === 0 ? (round % 2 ? "Player1" : "Player2") : diff > 0 ? "Player2" : "Player1";
  },
});
export type Session = Awaited<ReturnType<typeof enter>>;
