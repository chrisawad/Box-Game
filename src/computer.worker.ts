import { computerMove } from "./computer";
import type { State } from "./game";
self.onmessage = ({ data }: MessageEvent<State>) =>
  self.postMessage(computerMove(data));
