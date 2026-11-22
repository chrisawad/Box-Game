import { afterEach, expect, it, vi } from "vitest";
import { createRoomCodes, inviteURL, readInviteCode } from "../src/multiplayer/invite";
import { createRoomPersistence } from "../src/multiplayer/persistence";

afterEach(() => vi.unstubAllGlobals());

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
