import { expect, it } from "vitest";
import { RoomError, roomFailure, roomMessages } from "../src/room-feedback";

it("distinguishes expired public matches from missing private rooms", () => {
  const missing = { type: "peer-unavailable" };
  expect(roomFailure(missing, "public")).toBe(roomMessages.publicGone);
  expect(roomFailure(missing, "join")).toBe(roomMessages.missing);
});

it("distinguishes service, device, browser and restore failures", () => {
  expect(roomFailure({ type: "socket-error" }, "create")).toBe(roomMessages.service);
  expect(roomFailure({ type: "webrtc" }, "join")).toBe(roomMessages.direct);
  expect(roomFailure({ type: "browser-incompatible" }, "join")).toBe(roomMessages.browser);
  expect(roomFailure({ type: "unavailable-id" }, "restore")).toContain("original host tab");
});

it("preserves game-authored advice and replaces raw third-party errors", () => {
  expect(roomFailure(new RoomError(roomMessages.full), "join")).toBe(roomMessages.full);
  const raw = new Error("PeerJS: internal connection ID");
  expect(roomFailure(raw, "public")).toMatch(/public match.*search|public match.*retry/i);
  expect(roomFailure(raw, "play")).not.toContain(raw.message);
});
