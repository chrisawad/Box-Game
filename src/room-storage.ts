import { validPlayer, validSize, type Player, type Size } from "./game";
import { createRoomCodes } from "./multiplayer/invite";
import { createRoomPersistence } from "./multiplayer/persistence";

export const codes = createRoomCodes(6);
export const roomStorageKey = "box-game.peer-room.v1";
export const roomStore = createRoomPersistence<Player, Size>({
  namespace: "chrisawad-box-v1", codes, roomKey: roomStorageKey, lobbyKey: "box-game.waiting-host.v1",
  isProfile: (value): value is Player => validPlayer(value as Player),
  isSettings: (value): value is Size => validSize(value as Size),
});
export const { waitingHost, clear: clearRoom } = roomStore;
