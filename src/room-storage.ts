export const roomStorageKey = "box-game.peer-room.v1";

export function clearRoom() {
  try {
    sessionStorage.removeItem(roomStorageKey);
  } catch {}
}
