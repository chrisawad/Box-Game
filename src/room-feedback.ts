import { createRoomFeedback } from "./multiplayer/feedback";
export { RoomError, type RoomOperation } from "./multiplayer/feedback";
export const { roomMessages, roomFailure } = createRoomFeedback(6);
