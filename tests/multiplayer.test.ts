import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRoomCodes, inviteURL, readInviteCode } from "../src/multiplayer/invite";
import { createRoomPersistence } from "../src/multiplayer/persistence";
import { openPeerRoom } from "../src/multiplayer/room";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("peerjs", () => ({
  util: { defaultConfig: { iceServers: [] } },
  Peer: class { constructor() { return register(); } },
}));

afterEach(() => vi.unstubAllGlobals());

it("listens for registration immediately when reopening an action room with default connection settings", () => {
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout, clearInterval }));
  vi.stubGlobal("navigator", { onLine: true });
  const peer = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  register.mockReturnValue(peer);
  const waiting = vi.fn();
  const room = openPeerRoom({
    namespace: "counter", isProfile: (value): value is string => typeof value === "string", parseAction: () => null,
  }, "Amy", null, { waiting, start: vi.fn(), action: vi.fn(), failure: vi.fn() }, { code: "ABC23" });
  try {
    peer.emit("open");
    expect(waiting).toHaveBeenCalledWith("ABC23", expect.any(String));
  } finally { room.close(); }
});

it("keeps five-character invites compatible and supports a second game's code format", () => {
  const codes = createRoomCodes(6);
  const url = new URL(inviteURL("ABC234", "https://games.example/second/?private=1#old"));
  expect(url.href).toBe("https://games.example/second/?room=ABC234");
  expect(readInviteCode(url)).toBeNull();
  expect(readInviteCode(url, codes)).toBe("ABC234");
  expect(readInviteCode(new URL("https://games.example/first/?room=abc23"))).toBe("ABC23");
  expect(codes.isRoomCode(codes.newRoomCode())).toBe(true);
});

it("isolates active seats and waiting lobbies for two games sharing an origin", () => {
  const entries = new Map<string, string>();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
  const validators = {
    isProfile: (p: unknown): p is string => typeof p === "string",
    isSettings: (s: unknown): s is number => typeof s === "number",
  };
  const first = createRoomPersistence({ namespace: "first", ...validators });
  const second = createRoomPersistence({ namespace: "second", ...validators });
  const lobby = { code: "ABC23", profile: { player: "Amy", size: 3, public: true } };
  first.waitingHost.remember(lobby);
  second.waitingHost.remember(lobby);
  first.remember({ seat: "Player1" });
  second.remember({ seat: "Player2" });
  first.clear();
  first.waitingHost.forget(lobby);
  expect(first.read()).toBeNull();
  expect(first.waitingHost.read()).toBeNull();
  expect(second.read()).toEqual({ seat: "Player2" });
  expect(second.waitingHost.read()?.profile).toEqual(lobby.profile);
});

it("recovers the selected room in a new window and never resurrects a seat released in another window", () => {
  function storage() {
    const entries = new Map<string, string>();
    return {
      get length() { return entries.size; },
      key: (index: number) => [...entries.keys()][index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    };
  }
  const original = storage();
  vi.stubGlobal("sessionStorage", original);
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("navigator", { locks: {} });
  const store = createRoomPersistence({ namespace: "resume",
    isProfile: (p): p is string => typeof p === "string",
    isSettings: (s): s is number => typeof s === "number",
  });
  const one = { room: { code: "ABC23", status: "active" }, seat: "Player1", ticket: "first" };
  const two = { room: { code: "DEF45", status: "active" }, seat: "Player2", ticket: "second" };
  store.saveMatch(one);
  vi.stubGlobal("sessionStorage", storage());
  expect(store.readMatch()).toEqual(one);
  store.saveMatch(two);
  expect(store.readMatch(one.room.code)).toEqual(one);
  expect(store.readMatch("ZZZ99")).toBeUndefined();
  store.forgetMatch(one);
  expect(store.readMatch()).toEqual(two);
  vi.stubGlobal("sessionStorage", original);
  expect(store.readMatch(one.room.code)).toBeUndefined();
  expect(store.readMatch(two.room.code)).toEqual(two);
  store.saveMatch(one);
  vi.stubGlobal("sessionStorage", storage());
  const otherSeat = { ...one, seat: "Player2", ticket: "other-seat" };
  store.saveMatch(otherSeat);
  vi.stubGlobal("sessionStorage", original);
  expect(store.readMatch(one.room.code)).toEqual(one);
  store.forgetMatch(one);
  expect(store.readMatch(one.room.code)).toEqual(otherSeat);
});
