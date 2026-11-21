import Peer, { type DataConnection, type PeerOptions } from "peerjs";
import {
  colors,
  finished,
  fresh,
  place,
  score,
  validPlayer,
  validState,
  type Player,
  type State,
  type Size,
  type Side,
} from "./game";

type Member = Player & { connected: boolean };
type Room = {
  code: string;
  public: boolean;
  status: "waiting" | "active" | "finished" | "abandoned";
  round: number;
  players: { player1: Member; player2?: Member };
  state: State;
  rematchRequester?: Side;
};
export type OnlineView = {
  room: Room;
  seat: Side;
  direct: boolean;
  connected: boolean;
  syncing: boolean;
};
type Saved = { room: Room; seat: Side; ticket: string };
type Packet = {
  type: string;
  ticket?: string;
  player?: Player;
  room?: Room;
  edge?: string;
  ply?: number;
  round?: number;
  reason?: string;
  code?: string;
};
const key = "box-game.peer-room.v1",
  prefix = "chrisawad-box-v1-",
  alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomCode = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (b) => alphabet[b % 32],
  ).join("");
export const codeIsValid = (code: string) => /^[A-HJ-NP-Z2-9]{6}$/.test(code);
const hostId = (code: string) => prefix + "room-" + code;
const queueId = (s: Size) => prefix + "queue-" + s.columns + "x" + s.rows;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
function roomOK(r: Room) {
  return (
    r &&
    codeIsValid(r.code) &&
    Number.isInteger(r.round) &&
    r.round > 0 &&
    ["waiting", "active", "finished", "abandoned"].includes(r.status) &&
    validPlayer(r.players?.player1) &&
    (!r.players.player2 || validPlayer(r.players.player2)) &&
    validState(r.state)
  );
}
export function savedRoom(): Saved | undefined {
  try {
    const s = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      s &&
      roomOK(s.room) &&
      ["Player1", "Player2"].includes(s.seat) &&
      typeof s.ticket === "string" &&
      s.room.status !== "abandoned"
    )
      return s;
  } catch {}
}
export function clearRoom() {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
const options: PeerOptions = import.meta.env.VITE_PEER_HOST
  ? {
      host: import.meta.env.VITE_PEER_HOST,
      port: Number(import.meta.env.VITE_PEER_PORT || 443),
      path: import.meta.env.VITE_PEER_PATH || "/",
      secure: import.meta.env.VITE_PEER_SECURE !== "false",
    }
  : { secure: true };
function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, options) : new Peer(options);
    const timeout = setTimeout(
      () =>
        fail(
          Error(
            "The pairing service took too long. Check your connection and try again.",
          ),
        ),
      14000,
    );
    function fail(e: Error) {
      clearTimeout(timeout);
      peer.destroy();
      reject(e);
    }
    peer.once("error", fail);
    peer.once("open", () => {
      clearTimeout(timeout);
      peer.off("error", fail);
      resolve(peer);
    });
  });
}
function packet(data: unknown): Packet | undefined {
  if (typeof data !== "string" || data.length > 40000) return;
  try {
    const p = JSON.parse(data);
    if (p && typeof p.type === "string") return p;
  } catch {}
}
function send(ch: DataConnection | undefined, p: Packet) {
  if (ch?.open) ch.send(JSON.stringify(p));
}
function link(peer: Peer, id: string, type: string) {
  return peer.connect(id, {
    reliable: true,
    serialization: "json",
    metadata: { app: "box-game-v1", type },
  });
}
function collision(e: unknown) {
  return (e as { type?: string })?.type === "unavailable-id";
}
async function allocateHost() {
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    try {
      return { code, peer: await openPeer(hostId(code)) };
    } catch (e) {
      if (!collision(e)) throw e;
    }
  }
  throw Error("Could not reserve a code. Try again.");
}
function publicCode(peer: Peer, size: Size): Promise<string> {
  return new Promise((resolve, reject) => {
    const ch = link(peer, queueId(size), "find");
    const end = (code?: string) => {
      clearTimeout(timer);
      ch.close();
      if (code) resolve(code);
      else
        reject(
          Error("That public room just filled. Try finding a game again."),
        );
    };
    const timer = setTimeout(() => end(), 8000);
    ch.on("data", (d) => {
      const p = packet(d);
      if (p?.type === "invite" && p.code && codeIsValid(p.code)) end(p.code);
    });
    ch.on("error", () => end());
  });
}
export class Session {
  private channel?: DataConnection;
  private alias?: Peer;
  private listen?: (v: OnlineView) => void;
  private report?: (s: string) => void;
  private closed = false;
  private joined = false;
  private pending = false;
  private retry = 0;
  private deadline = 0;
  private firstJoin?: { resolve: () => void; reject: (e: Error) => void };
  private readonly onPageHide = () => this.stop();
  constructor(
    private peer: Peer,
    private data: Saved,
    private me: Player,
  ) {
    this.peer.on("connection", (ch) => this.incoming(ch));
    this.peer.on("error", (e) => {
      if (e.type === "peer-unavailable" && this.firstJoin)
        this.firstJoin.reject(
          Error(
            "Room not found. Check the code and keep the host’s game open.",
          ),
        );
      else if (e.type !== "peer-unavailable" && !this.closed)
        this.report?.(
          "Pairing service interrupted. An open game can keep playing.",
        );
    });
    this.peer.on("disconnected", () => {
      if (!this.closed && !this.peer.destroyed)
        setTimeout(() => {
          if (!this.closed && this.peer.disconnected && !this.peer.destroyed)
            this.peer.reconnect();
        }, 1000);
    });
    window.addEventListener("pagehide", this.onPageHide);
  }
  watch(show: (v: OnlineView) => void, error: (s: string) => void) {
    this.listen = show;
    this.report = error;
    this.reflect();
  }
  private reflect() {
    if (this.closed) return;
    const { room, seat } = this.data;
    const connected = this.joined && !!this.channel?.open;
    room.players.player1.connected = seat === "Player1" || connected;
    if (room.players.player2)
      room.players.player2.connected = seat === "Player2" || connected;
    try {
      sessionStorage.setItem(key, JSON.stringify(this.data));
    } catch {}
    this.listen?.({
      room: structuredClone(room),
      seat,
      direct: connected,
      connected: connected || room.status === "waiting",
      syncing: this.pending,
    });
  }
  public serve(queue: Peer) {
    this.alias = queue;
    queue.on("error", () => {});
    queue.on("connection", (ch) => {
      if (ch.metadata?.type !== "find") {
        ch.close();
        return;
      }
      ch.on("open", () => {
        if (this.data.room.status === "waiting")
          send(ch, { type: "invite", code: this.data.room.code });
        setTimeout(() => ch.close(), 1200);
      });
      ch.on("error", () => {});
    });
  }
  private incoming(ch: DataConnection) {
    if (
      this.closed ||
      this.data.seat !== "Player1" ||
      ch.metadata?.app !== "box-game-v1" ||
      ch.metadata?.type !== "join"
    ) {
      ch.close();
      return;
    }
    let accepted = false;
    const timeout = setTimeout(() => {
      if (!accepted) ch.close();
    }, 8000);
    ch.on("data", (d) => {
      const p = packet(d);
      if (!p) return;
      if (!accepted) {
        if (
          p.type !== "hello" ||
          !p.player ||
          !validPlayer(p.player) ||
          typeof p.ticket !== "string" ||
          !/^[a-f0-9-]{36}$/i.test(p.ticket)
        )
          return;
        if (
          this.data.room.status === "abandoned" ||
          (this.data.ticket && this.data.ticket !== p.ticket)
        ) {
          send(ch, {
            type: "reject",
            reason: "This room already has two players.",
          });
          setTimeout(() => ch.close(), 250);
          return;
        }
        clearTimeout(timeout);
        accepted = true;
        const previous = this.channel;
        this.channel = ch;
        previous?.close();
        this.joined = true;
        this.data.ticket = p.ticket;
        const r = this.data.room;
        if (!r.players.player2) {
          const color =
            r.players.player1.color === p.player.color
              ? (Object.keys(colors) as (keyof typeof colors)[]).find(
                  (c) => c !== p.player!.color,
                )!
              : p.player.color;
          r.players.player2 = {
            initials: p.player.initials,
            color,
            connected: true,
          };
          r.status = "active";
        }
        this.alias?.destroy();
        this.alias = undefined;
        this.publish();
        return;
      }
      if (this.channel === ch) this.hostAction(p);
    });
    ch.on("close", () => {
      clearTimeout(timeout);
      if (this.channel === ch) this.lost();
    });
    ch.on("error", () => {
      clearTimeout(timeout);
      if (this.channel === ch) this.lost();
    });
  }
  private hostAction(p: Packet) {
    if (p.type === "leave") {
      this.data.room.status = "abandoned";
      this.reflect();
      return;
    }
    if (
      p.type === "move" &&
      p.edge &&
      p.round === this.data.room.round &&
      p.ply === Object.keys(this.data.room.state.lines).length
    )
      this.apply(p.edge, "Player2");
    if (p.type === "rematch" && p.round === this.data.room.round)
      this.reset("Player2");
    this.publish();
  }
  private apply(edge: string, seat: Side) {
    const r = this.data.room;
    if (!this.joined || r.status !== "active" || r.state.currentPlayer !== seat)
      return;
    const next = place(r.state, edge);
    if (next === r.state) return;
    r.state = next;
    if (finished(next)) {
      r.status = "finished";
      const diff = score(next, "Player1") - score(next, "Player2");
      r.rematchRequester =
        diff === 0
          ? r.round % 2
            ? "Player1"
            : "Player2"
          : diff > 0
            ? "Player2"
            : "Player1";
    }
  }
  private reset(seat: Side) {
    const r = this.data.room;
    if (!this.joined || r.status !== "finished" || r.rematchRequester !== seat)
      return;
    r.state = fresh(r.state.board);
    r.round++;
    r.status = "active";
    delete r.rematchRequester;
  }
  private publish() {
    this.reflect();
    send(this.channel, { type: "state", room: this.data.room });
  }
  private lost() {
    const old = this.channel;
    this.channel = undefined;
    this.joined = false;
    this.pending = false;
    clearTimeout(this.deadline);
    old?.close();
    this.reflect();
    if (
      !this.closed &&
      this.data.seat === "Player2" &&
      !this.firstJoin &&
      this.data.room.status !== "abandoned"
    ) {
      clearTimeout(this.retry);
      this.retry = window.setTimeout(() => this.dial(), 2000);
    }
  }
  private dial() {
    if (this.closed || this.channel?.open) return;
    const ch = link(this.peer, hostId(this.data.room.code), "join");
    this.channel = ch;
    clearTimeout(this.deadline);
    this.deadline = window.setTimeout(() => {
      if (this.channel === ch && !this.joined) this.lost();
    }, 12000);
    ch.on("open", () =>
      send(ch, { type: "hello", ticket: this.data.ticket, player: this.me }),
    );
    ch.on("data", (data) => {
      if (this.closed || this.channel !== ch) return;
      const p = packet(data);
      if (p?.type === "reject") {
        this.firstJoin?.reject(Error("This room already has two players."));
        return;
      }
      if (p?.type === "leave") {
        this.data.room.status = "abandoned";
        this.reflect();
        return;
      }
      if (
        p?.type !== "state" ||
        !p.room ||
        !roomOK(p.room) ||
        p.room.code !== this.data.room.code ||
        !p.room.players.player2
      )
        return;
      clearTimeout(this.deadline);
      this.joined = true;
      this.pending = false;
      this.data.room = p.room;
      this.reflect();
      this.firstJoin?.resolve();
    });
    ch.on("close", () => {
      if (this.channel === ch) this.lost();
    });
    ch.on("error", () => {
      if (this.channel === ch) this.lost();
    });
  }
  async connect(resume: boolean) {
    if (resume) {
      this.dial();
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        this.firstJoin = { resolve, reject };
        this.retry = window.setTimeout(
          () =>
            reject(
              Error(
                "Could not connect. Keep the host’s room open and try another network if needed.",
              ),
            ),
          16000,
        );
        this.dial();
      });
    } finally {
      this.firstJoin = undefined;
      clearTimeout(this.retry);
    }
  }
  move(edge: string) {
    const { room: r, seat } = this.data;
    if (
      this.pending ||
      !this.joined ||
      r.status !== "active" ||
      r.state.currentPlayer !== seat ||
      !gridHasMove(r.state, edge)
    )
      return;
    if (seat === "Player1") {
      this.apply(edge, seat);
      this.publish();
    } else {
      this.pending = true;
      this.reflect();
      send(this.channel, {
        type: "move",
        edge,
        round: r.round,
        ply: Object.keys(r.state.lines).length,
      });
    }
  }
  rematch() {
    const r = this.data.room;
    if (!this.joined || r.rematchRequester !== this.data.seat) return;
    if (this.data.seat === "Player1") {
      this.reset("Player1");
      this.publish();
    } else send(this.channel, { type: "rematch", round: r.round });
  }
  async leave() {
    send(this.channel, { type: "leave" });
    clearRoom();
    await sleep(100);
    this.stop();
    clearRoom();
  }
  stop() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.retry);
    clearTimeout(this.deadline);
    this.alias?.destroy();
    this.channel?.close();
    this.peer.destroy();
    window.removeEventListener("pagehide", this.onPageHide);
  }
}
function gridHasMove(s: State, key: string) {
  return place(s, key) !== s;
}
export async function enter(
  action: "create" | "public" | "join" | "restore",
  player: Player,
  size: Size,
  code = "",
): Promise<Session> {
  if (!navigator.onLine) throw Error("Connect to the internet to play online.");
  if (typeof RTCPeerConnection === "undefined")
    throw Error(
      "This browser needs WebRTC for online games. Try a current browser or play locally.",
    );
  const saved = action === "restore" ? savedRoom() : undefined;
  if (action === "restore" && !saved)
    throw Error("Room expired. Start or join another game.");
  if (action === "join" && !codeIsValid(code))
    throw Error("Enter the six-character room code.");
  let peer: Peer | undefined,
    alias: Peer | undefined,
    session: Session | undefined;
  try {
    if (action === "public") {
      // Make the game endpoint available before advertising the queue alias.
      const allocated = await allocateHost();
      peer = allocated.peer;
      code = allocated.code;
      try {
        alias = await openPeer(queueId(size));
      } catch (e) {
        if (!collision(e)) throw e;
      }
    }
    const host = action === "create" || !!alias || saved?.seat === "Player1";
    if (host) {
      if (saved) {
        code = saved.room.code;
        for (let i = 0; !peer; i++) {
          try {
            peer = await openPeer(hostId(code));
          } catch (e) {
            if (!collision(e) || i >= 4) throw e;
            await sleep(800);
          }
        }
        if (saved.room.public && saved.room.status === "waiting") {
          try {
            alias = await openPeer(queueId(size));
          } catch {
            saved.room.public = false;
          }
        }
      } else if (!peer) {
        const allocated = await allocateHost();
        peer = allocated.peer;
        code = allocated.code;
      }
    } else {
      peer ??= await openPeer();
      if (action === "public") code = await publicCode(peer, size);
      if (saved) code = saved.room.code;
    }
    const state: Saved = saved ?? {
      ticket: host ? "" : crypto.randomUUID(),
      seat: host ? "Player1" : "Player2",
      room: {
        code,
        public: action === "public",
        round: 1,
        status: "waiting",
        players: { player1: { ...player, connected: true } },
        state: fresh(size),
      },
    };
    session = new Session(peer, state, player);
    if (alias) session.serve(alias);
    if (!host) await session.connect(!!saved);
    return session;
  } catch (e) {
    if (session) session.stop();
    else {
      peer?.destroy();
      alias?.destroy();
    }
    if (collision(e))
      throw Error("The host already has this room open in another tab.");
    throw e;
  }
}
