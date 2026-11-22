import { createLobbyStore } from "./lobby-store";
import { createRoomCodes } from "./invite";

export type LobbySettings<Profile, Settings> = { player: Profile; size: Settings; public: boolean };

export function createRoomPersistence<Profile, Settings>(options: {
  namespace: string;
  codes?: ReturnType<typeof createRoomCodes>;
  roomKey?: string;
  lobbyKey?: string;
  isProfile: (value: unknown) => value is Profile;
  isSettings: (value: unknown) => value is Settings;
}) {
  const codes = options.codes ?? createRoomCodes();
  const roomKey = options.roomKey ?? options.namespace + ":match";
  const waitingHost = createLobbyStore(options.lobbyKey ?? options.namespace + ":waiting-host",
    (value): value is LobbySettings<Profile, Settings> => {
      const data = value as Partial<LobbySettings<Profile, Settings>> | null;
      return !!data && options.isProfile(data.player) && options.isSettings(data.size) && typeof data.public === "boolean";
    }, codes.isRoomCode);
  function read(): unknown {
    try { return JSON.parse(sessionStorage.getItem(roomKey) ?? "null"); } catch { return null; }
  }
  function remember(value: unknown) {
    try { sessionStorage.setItem(roomKey, JSON.stringify(value)); } catch { /* Storage is optional. */ }
  }
  function clear() {
    try { sessionStorage.removeItem(roomKey); } catch { /* Storage is optional. */ }
  }
  return { namespace: options.namespace, codes, isProfile: options.isProfile, waitingHost, read, remember, clear };
}
export type RoomPersistence<P, S> = ReturnType<typeof createRoomPersistence<P, S>>;
