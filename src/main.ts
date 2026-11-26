import "./style.css";
import { registerSW } from "virtual:pwa-register";
import {
  colors,
  finished,
  fresh,
  grid,
  initials,
  other,
  place,
  score,
  validPlayer,
  validSize,
  validState,
  type Color,
  type Mode,
  type Pair,
  type Side,
  type Size,
  type State,
} from "./game";
import { boardHtml, esc, fallbackArt, frame, icon } from "./ui";
import { setupInstall } from "./install";
import { createWinCelebration } from "./celebration";
import { createWinAudio } from "./win-audio";
import type { OnlineView, Session } from "./online";
import { clearRoom, codes, roomStore, waitingHost } from "./room-storage";
import { drawInviteQR, inviteParameter, inviteURL, shareInvite } from "./multiplayer/invite";
import { roomFailure, roomMessages, type RoomOperation } from "./room-feedback";
const { isRoomCode } = codes;
const publicGameURL = "https://boxes.chrisawad.com/";
const publicRoomURL = (code: string) => inviteURL(code, publicGameURL, "fragment");

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const app = $("#app"),
  dialog = $<HTMLDialogElement>("#dialog");
function read<T>(key: string): T | undefined {
  try {
    return (
      JSON.parse(localStorage.getItem("box-game." + key) ?? "null") ?? undefined
    );
  } catch {
    return undefined;
  }
}
function save(key: string, data: unknown) {
  try {
    localStorage.setItem("box-game." + key, JSON.stringify(data));
  } catch {
    /* Private browsing still supports a full match. */
  }
}
type Prefs = { mode: Mode; size: Size; players: Pair; sound: boolean };
const defaults: Prefs = {
  mode: "solo",
  size: { columns: 4, rows: 4 },
  players: {
    Player1: { initials: "P1", color: "Purple" },
    Player2: { initials: "P2", color: "Orange" },
  },
  sound: true,
};
const stored = read<Prefs>("prefs");
const prefs =
  stored &&
  validSize(stored.size) &&
  ["local", "online", "solo"].includes(stored.mode) &&
  validPlayer(stored.players?.Player1) &&
  validPlayer(stored.players?.Player2)
    ? stored
    : defaults;
const persist = () => save("prefs", prefs);
type Match = { mode: Mode; players: Pair; state: State; last?: string };
let match: Match | undefined,
  view: OnlineView | undefined,
  room: Session | undefined;
const incomingCode = inviteParameter(new URL(location.href));
const hasInvite = incomingCode !== undefined;
// Re-enter the normal invite flow if a link changes only this document's fragment.
window.addEventListener("hashchange", () => {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has("room") || fragment.get("from") === "games-dashboard") location.reload();
});
// Keep an invited guest's refresh quiet after joining removes the invite.
const inviteVisit = hasInvite || history.state?.boxGameInvite === true;
const resumeCode = history.state?.setupAfterUpdate ? undefined : savedMatchCode(hasInvite ? incomingCode : undefined);
const peerSave = !history.state?.setupAfterUpdate && (resumeCode || (!hasInvite && (roomStore.readMatch() || waitingHost.read())));
let previousMode: "solo" | "local" = prefs.mode === "local" ? "local" : "solo";
type RoomAction = Exclude<RoomOperation, "restore" | "play">;
let roomAction: RoomAction = hasInvite ? "join" : "create";
if (hasInvite) prefs.mode = "online";
let screen: "setup" | "game" | "waiting" = "setup",
  joinCode = incomingCode && isRoomCode(incomingCode) ? incomingCode : "",
  working = false,
  artOff: (() => void) | undefined;
let worker: Worker | undefined,
  timer = 0,
  focusEdge = "",
  roomGeneration = 0;
let context: AudioContext | undefined;
const music = createWinAudio();
let celebrate: ReturnType<typeof createWinCelebration> | undefined;
const announce = (m: string) => {
  $("#announcement").textContent = m;
};
const notify = (m: string) => {
  const feedback = document.querySelector("#room-feedback");
  $("#notice").textContent = feedback ? "" : m;
  if (feedback) feedback.textContent = m;
  announce(m);
};
function unlock() {
  if (!prefs.sound) return;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    /* silent device */
  }
}
function note(capture: boolean) {
  if (!context || !prefs.sound || context.state !== "running") return;
  const osc = context.createOscillator(),
    vol = context.createGain(),
    t = context.currentTime;
  osc.type = "sine";
  osc.frequency.setValueAtTime(capture ? 510 : 265, t);
  osc.frequency.exponentialRampToValueAtTime(capture ? 760 : 190, t + 0.09);
  vol.gain.setValueAtTime(0.0001, t);
  vol.gain.exponentialRampToValueAtTime(0.07, t + 0.008);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  osc.connect(vol).connect(context.destination);
  osc.onended = () => {
    osc.disconnect();
    vol.disconnect();
  };
  osc.start(t);
  osc.stop(t + 0.15);
}
app.innerHTML =
  '<header><div class="brand"><img src="./icons/board-192.png" width="40" height="40" alt="">' +
  '<span>Box Game<span class="period">.</span></span></div><nav><button class="round" id="update" aria-label="Game update available" title="Game update available" aria-haspopup="dialog" aria-controls="dialog" hidden>' +
  icon("install") +
  '</button><button class="round" id="install" aria-label="Install Boxes" title="Install Boxes" aria-haspopup="dialog" aria-controls="dialog" hidden>' +
  icon("install") +
  '</button><button class="plain share-button" data-action="share" aria-label="Share" title="Share">' +
  icon("share") + '<span>Share</span></button><button class="plain help-button" data-action="help" aria-label="How to play" title="How to play" aria-haspopup="dialog">' +
  icon("help") +
  '<span>How to play</span></button><button class="round" id="sound" data-action="sound"></button></nav></header><section id="surface"></section><footer><span id="notice" role="status"></span></footer>';
function soundUI() {
  const b = $("#sound");
  b.innerHTML = icon(prefs.sound ? "sound" : "mute");
  b.setAttribute("aria-label", prefs.sound ? "Mute sound" : "Enable sound");
  b.setAttribute("aria-pressed", String(prefs.sound));
}
soundUI();
function modal(title: string, body: string, className = "") {
  if (dialog.open) dialog.close();
  dialog.className = className;
  dialog.innerHTML = frame(title, body);
  dialog.showModal();
}
function close() {
  if (dialog.open) dialog.close();
}
dialog.addEventListener("close", () => {
  celebrate?.stop();
  music.stop();
});
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) close();
});
const updateButton = $<HTMLButtonElement>("#update");
const updateKey = "box-game.update-offered";
let updateShown = false;
try {
  updateShown = sessionStorage.getItem(updateKey) === import.meta.url;
} catch {}
function showUpdate() {
  modal(
    "Game update ready",
    '<p id="update-warning">Updating will exit any active game in this tab and return you to setup. You’ll lose progress in that game.</p><div class="dialog-actions"><button class="primary" data-action="apply-update" aria-describedby="update-warning">' +
      icon("install") + ' Update now</button><button class="plain" data-action="close" aria-describedby="update-warning" autofocus>Cancel</button></div>',
  );
  updateShown = true;
  try {
    sessionStorage.setItem(updateKey, import.meta.url);
  } catch {}
}
function offerUpdate() {
  if (inviteVisit || peerSave || working || room || match?.mode === "online" || dialog.open) return;
  if (!updateButton.hidden && !updateShown) showUpdate();
}
dialog.addEventListener("close", offerUpdate);
setupInstall(
  $<HTMLButtonElement>("#install"),
  dialog,
  publicGameURL,
  () => $<HTMLButtonElement>(".share-button").focus(),
  () => updateButton.hidden && !inviteVisit && !peerSave && !working && !room && !match && screen === "setup",
);
function updateReady() {
  updateButton.hidden = false;
  offerUpdate();
}
const updateSW = registerSW({
  onNeedRefresh: updateReady,
  // If another tab updates, let this player decide when to reload.
  onNeedReload: updateReady,
});
updateButton.onclick = showUpdate;
async function applyUpdate(button: HTMLButtonElement) {
  button.disabled = true;
  button.textContent = "Updating…";
  const finishUpdate = async () => {
    if (!dialog.open || !button.isConnected) return;
    close();
    app.inert = true;
    try {
      await leaveGame();
      history.replaceState({ ...history.state, setupAfterUpdate: true }, "");
      try { sessionStorage.removeItem(updateKey); } catch {}
    } finally {
      location.reload();
    }
  };
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!dialog.open || !button.isConnected) return;
    if (!registration?.waiting) {
      await finishUpdate();
      return;
    }
    navigator.serviceWorker.addEventListener("controllerchange", finishUpdate, { once: true });
    await updateSW();
  } catch {
    navigator.serviceWorker.removeEventListener("controllerchange", finishUpdate);
    if (!dialog.open || !button.isConnected) return;
    button.disabled = false;
    button.textContent = "Try again";
    const warning = $("#update-warning");
    warning.setAttribute("role", "alert");
    warning.textContent = "The update couldn’t finish. Try again to exit the game and update, or choose Cancel to keep playing.";
  }
}
const modes = { solo: "Solo", local: "Local", online: "Online" };
const modeHelp = {
  solo: "Face the computer. Watch for long chains.",
  local: "Two players share one screen and take turns.",
};
const names: Side[] = ["Player1", "Player2"];
function playerInput(side: Side) {
  const player = prefs.players[side];
  const cpu = prefs.mode === "solo" && side === "Player2";
  const title = cpu ? "Computer" : prefs.mode === "local"
    ? (side === "Player1" ? "Player 1" : "Player 2") : "Your player";
  const initialsLabel = title === "Your player" ? "Your initials" : title + " initials";
  const swatches = Object.entries(colors).map(([name, hex]) => `
    <label class="swatch" title="${name}" style="--ink:${hex}">
      <input type="radio" name="color-${side}" data-color-side="${side}" value="${name}" aria-label="${name}" ${player.color === name ? "checked" : ""}>
      <span aria-hidden="true"></span>
    </label>`).join("");
  return `<section class="player-card" aria-labelledby="title-${side}">
    <div class="player-heading">
      <h3 id="title-${side}">${title}</h3>
      ${cpu ? "" : `<label class="initials-field" for="${side}">Initials
        <input id="${side}" name="${side}" data-player="${side}" aria-label="${initialsLabel}" value="${esc(player.initials)}" maxlength="6" autocomplete="off" spellcheck="false"></label>`}
    </div>
    <fieldset class="color-picker">
      <legend>Choose color<span id="selected-${side}" aria-hidden="true">${player.color}</span></legend>
      <div class="swatches">${swatches}</div>
    </fieldset>
  </section>`;
}
function stepper(key: keyof Size) {
  const n = prefs.size[key];
  return (
    '<div class="step"><button type="button" data-step="' +
    key +
    '-1" aria-label="Fewer ' +
    key +
    '" ' +
    (n <= 2 ? "disabled" : "") +
    '>−</button><span aria-label="' +
    key +
    '">' +
    n +
    '</span><button type="button" data-step="' +
    key +
    '+1" aria-label="More ' +
    key +
    '" ' +
    (n >= 10 ? "disabled" : "") +
    ">+</button></div>"
  );
}
function boardSizeFields() {
  return '<div class="field-head"><h3>Board size</h3><span>' +
    prefs.size.rows * prefs.size.columns +
    ' boxes</span></div><div class="dimensions">' +
    stepper("columns") + "<span>×</span>" + stepper("rows") + "</div>";
}
const roomOptions = {
  create: { label: "Host a game", help: "Create a private room and invite a friend by code, link, or QR code.", submit: "Create private room" },
  join: { label: "Join a friend", help: "Enter your friend’s six-character code to join their private room.", submit: "Join room" },
  public: { label: "Public match", help: "Find another player looking for the same board size.", submit: "Find public game" },
};
function roomFields() {
  const option = roomOptions[roomAction];
  const help = roomAction === "join" && joinCode && joinCode === incomingCode
    ? "Your invite filled in the room code. Choose your player color and join."
    : option.help;
  $("#room-form").innerHTML =
    '<p class="mode-help" id="room-help">' + help + '</p>' +
    (roomAction === "join"
      ? '<label class="room-code-label" for="code">Room code</label><input id="code" name="room" aria-describedby="room-help" placeholder="ABC234" maxlength="6" pattern="[A-HJ-NP-Z2-9]{6}" title="Enter the six-character room code from your friend." required autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" value="' + esc(joinCode) + '">'
      : "") +
    '<div class="player-list">' +
    playerInput("Player1") + '</div>' +
    (roomAction === "join" ? "" : boardSizeFields()) +
    '<button class="primary" type="submit">' + option.submit + '</button>';
}
function settings() {
  if (prefs.mode === "online") {
    const resumeCode = savedMatchCode(hasInvite ? incomingCode : undefined);
    $("#settings").innerHTML =
      '<button type="button" class="room-back plain" data-mode="' + previousMode + '">' + icon("back") + 'All modes</button>' +
      '<h1 id="online-title" tabindex="-1">Play online</h1><fieldset class="room-options"><legend>Room options</legend><div>' +
      Object.entries(roomOptions).map(([value, option]) =>
        '<label><input type="radio" name="room-action" value="' + value + '"' +
        (value === roomAction ? " checked" : "") + '><span>' + option.label + '</span></label>',
      ).join("") +
      '</div></fieldset><form id="room-form" aria-labelledby="online-title"></form>' +
      (resumeCode ? '<button class="secondary" data-action="resume-room" data-room="' + esc(resumeCode) + '">Resume room ' + esc(resumeCode) + '</button>' : "");
    roomFields();
    setBusy(working);
    return;
  }
  $("#settings").innerHTML =
    '<h2>New game</h2><div class="mode-tabs" role="group" aria-label="Game mode">' +
    Object.entries(modes)
      .map(
        ([key, name]) =>
          '<button data-mode="' +
          key +
          '" aria-pressed="' +
          (prefs.mode === key) +
          '">' +
          icon(key) +
          name +
          "</button>",
      )
      .join("") +
    '</div><p class="mode-help">' +
    modeHelp[prefs.mode] +
    '</p><div class="player-list">' +
    playerInput("Player1") +
    playerInput("Player2") + "</div>" + boardSizeFields() +
    '<button class="primary" data-action="start">' + icon("start") + " Start game</button>";
  setBusy(working);
}
function setBusy(value: boolean) {
  working = value;
  const el = $("#settings");
  if (el) {
    el.toggleAttribute("inert", value);
    el.setAttribute("aria-busy", String(value));
  }
}
function cancelAI() {
  clearTimeout(timer);
  worker?.terminate();
  worker = undefined;
}
function setup() {
  screen = "setup";
  artOff?.();
  artOff = undefined;
  cancelAI();
  match = undefined;
  view = undefined;
  if (prefs.mode === "online") {
    $("#surface").innerHTML = '<section class="room-setup panel" aria-labelledby="online-title"><div id="settings"></div><p id="room-feedback"></p></section>';
    settings();
    return;
  }
  $("#surface").innerHTML =
    '<div class="setup-layout"><div class="showcase"><div class="hero-copy"><h1>Dots <em>&amp;</em> boxes<span>.</span></h1><p>Connect the dots. Close a box to claim it.</p></div><div class="art" aria-hidden="true">' +
    fallbackArt() +
    '</div><div class="hero-foot">' +
    icon("grid") +
    ' <span>Claim the most boxes to win</span></div></div><section id="settings" class="panel" aria-label="Match setup"></section></div>';
  settings();
  const host = $(".art");
  void import("./art")
    .then((m) => {
      if (host.isConnected) artOff = m.mountTable(host);
    })
    .catch(() => {});
}
function drawWaiting() {
  if (!view) return;
  screen = "waiting";
  artOff?.();
  artOff = undefined;
  const r = view.room;
  const waiting = r.status === "waiting";
  const status = !waiting ? "This room has closed."
    : r.public ? "Looking for a player for this board size…" : "Waiting for a friend to join…";
  const invite = waiting ? `
    <p class="room-code-label">Room code</p><strong class="room-code">${esc(r.code)}</strong>
    <canvas class="invite-qr" width="384" height="384" role="img" aria-label="QR code for room ${esc(r.code)}" hidden></canvas>
    <div class="invite-actions">
      <button class="plain" data-action="copy-link">${icon("link")}Copy link</button>
      <button class="plain" data-action="share-invite">${icon("share")}Share invite</button>
    </div>
    <p id="invite-feedback" role="status"></p>` : "";
  $("#surface").innerHTML = `<section class="room-lobby" aria-labelledby="lobby-title">
    <button class="plain leave-room" data-action="exit">${icon("exit")}Leave room</button>
    <h1 id="lobby-title">Online room</h1>
    <div class="waiting panel">
      <div class="waiting-mark">${icon("online")}</div>
      <p role="status">${status}</p>
      ${view.notice ? '<p class="connection-note" role="status">' + esc(view.notice) + '</p>' : ""}
      ${invite}
    </div>
  </section>`;
  if (waiting) void showInviteQR($<HTMLCanvasElement>(".invite-qr"), publicRoomURL(r.code));
}
async function showInviteQR(canvas: HTMLCanvasElement, url: string) {
  try {
    await drawInviteQR(canvas, url, 384, 4);
    canvas.hidden = false;
  } catch {
    if (canvas.isConnected) $("#invite-feedback").textContent = "The QR code couldn’t load. Use Copy link or Share invite.";
  }
}
function titleOf(m: Match) {
  const a = score(m.state, "Player1"),
    b = score(m.state, "Player2");
  return a === b
    ? "It’s a tie!"
    : m.players[a > b ? "Player1" : "Player2"].initials + " wins!";
}
function canRematch() {
  if (!view) return true;
  if (!view.connected || view.room.status !== "finished") return false;
  const votes = view.room.rematchVotes;
  return votes ? !votes[view.seat === "Player1" ? 0 : 1] : view.room.rematchRequester === view.seat;
}
function rematchHint() {
  if (!view || view.room.status !== "finished" || !view.connected) return "";
  const votes = view.room.rematchVotes;
  if (!votes) return canRematch() ? "" : "Your opponent can start the rematch.";
  const host = view.seat === "Player1";
  if (votes[host ? 0 : 1]) return "Waiting for your opponent to play again.";
  return votes[host ? 1 : 0] ? "Your opponent wants to play again." : "";
}
function game() {
  if (!match) return;
  const m = match,
    s = m.state,
    over = finished(s),
    side = s.currentPlayer,
    player = m.players[side],
    total = s.board.columns * s.board.rows;
  const opponentOffline =
    view &&
    !(view.seat === "Player1"
      ? view.room.players.player2?.connected
      : view.room.players.player1.connected);
  const locked =
    over ||
    (m.mode === "solo" && side === "Player2") ||
    !!(
      view &&
      (side !== view.seat ||
        view.syncing ||
        !view.connected ||
        opponentOffline ||
        view.room.status !== "active")
    );
  const message =
    view?.room.status === "abandoned"
      ? "Opponent left"
      : view && !view.connected
        ? "Waiting to reconnect…"
        : over
          ? titleOf(m)
          : opponentOffline
            ? "Opponent disconnected"
            : m.mode === "solo" && side === "Player2"
              ? "Computer is thinking…"
              : player.initials + "’s turn";
  const hadFocus = document.activeElement?.hasAttribute("data-edge");
  screen = "game";
  artOff?.();
  artOff = undefined;
  const subtitle =
    m.mode === "solo"
      ? "Solo match"
      : m.mode === "local"
        ? "Local match"
        : "Online · " + esc(view?.room.code ?? "");
  const scores = names
    .map(
      (p) =>
        '<div class="score ' +
        (!over && p === side ? "active" : "") +
        '" style="--ink:' +
        colors[m.players[p].color] +
        '"><i></i><div><small>' +
        (m.mode === "solo" && p === "Player2"
          ? "Computer"
          : p === "Player1"
            ? "Player 1"
            : "Player 2") +
        "</small><b>" +
        esc(m.players[p].initials) +
        "</b></div><strong>" +
        score(s, p) +
        "</strong></div>",
    )
    .join("");
  let connection = "";
  if (view) {
    const abandoned = view.room.status === "abandoned";
    const connected = view.connected && !opponentOffline && !abandoned;
    const status = abandoned ? "Leave this room to start another game."
      : connected ? 'Connected<span class="sr"> to opponent</span>'
      : "Your board is saved. Play resumes when both players reconnect.";
    const route = connected && view.route !== "unknown"
      ? `<span class="connection-route">${view.route === "relay" ? "Via relay" : "Direct"}</span>` : "";
    connection = `<div class="room-connection${connected ? " connected" : ""}">
      <span class="transport">${status}</span>${route}</div>`;
    if (view.notice) connection += `<p class="connection-note" role="status">${esc(view.notice)}</p>`;
  }
  const boardSize = `<span class="match-detail">${icon("grid")}${s.board.columns} × ${s.board.rows} board</span>`;
  const turn = `<div class="turn" role="status" style="--ink:${colors[player.color]}"><i></i>${esc(message)}</div>`;
  $("#surface").innerHTML =
    '<div class="match-layout"><section class="match-meta panel"><div class="kicker"><span></span>' +
    subtitle +
    '</div>' + connection + '<h1>Scoreboard</h1><div class="scores">' +
    scores +
    '</div>' +
    (view ? `<div class="room-actions">${turn}<button class="plain leave-room" data-action="exit">${icon("exit")}Leave room</button></div>` : turn + boardSize) +
    (over && rematchHint() ? '<p class="rematch-hint" role="status">' + rematchHint() + '</p>' : "") +
    (over && canRematch()
      ? '<button class="primary" data-action="again">Play again</button>'
      : "") +
    (view ? "" : '<button class="secondary" data-action="exit">New game</button>') +
    '</section><section class="play-area"><div class="board-space">' +
    boardHtml(s, m.players, locked, m.last) +
    '</div><div class="progress-row">' + (view ? boardSize : "") + '<span>' +
    Object.keys(s.lines).length +
    " / " +
    grid(s.board).edges.length +
    " lines</span><span>" +
    (total - Object.keys(s.boxes).length) +
    " boxes left</span></div></section></div>";
  if (hadFocus) {
    const b =
      $<HTMLButtonElement>('[data-edge="' + focusEdge + '"]:not(:disabled)') ??
      $<HTMLButtonElement>(".edge:not(:disabled)");
    b?.focus({ preventScroll: true });
  }
}
function result() {
  if (!match) return;
  const m = match,
    a = score(m.state, "Player1"),
    b = score(m.state, "Player2");
  const won =
    m.mode === "local"
      ? a !== b
      : view
        ? view.seat === "Player1"
          ? a > b
          : b > a
        : a > b;
  const msg =
    esc(m.players.Player1.initials) +
    " " +
    a +
    " &nbsp;·&nbsp; " +
    esc(m.players.Player2.initials) +
    " " +
    b;
  modal(
    titleOf(m),
    '<div class="trophy">' +
      icon(a === b ? "grid" : "trophy") +
      '</div><p class="result-score">' +
      msg +
      "</p>" +
      '<p class="rematch-hint" role="status">' + rematchHint() + '</p>' +
      (canRematch()
        ? '<button class="primary" data-action="again">Play again</button>'
        : "") +
      '<button class="plain" data-action="close">View board</button><canvas class="confetti" aria-hidden="true"></canvas>',
  );
  dialog.className = "result-dialog";
  if (won) {
    celebrate = createWinCelebration($(".confetti"));
    celebrate.play();
    if (context && prefs.sound) music.play(context);
  }
}
function afterMove(next: State, key: string) {
  if (!match || next === match.state) return;
  const captures =
    Object.keys(next.boxes).length - Object.keys(match.state.boxes).length;
  match = { ...match, state: next, last: key };
  save("match", match);
  game();
  note(captures > 0);
  if (finished(next)) {
    result();
    return;
  }
  scheduleAI();
}
function scheduleAI() {
  cancelAI();
  if (
    !match ||
    match.mode !== "solo" ||
    match.state.currentPlayer !== "Player2" ||
    finished(match.state)
  )
    return;
  const state = match.state;
  timer = window.setTimeout(() => {
    worker = new Worker(new URL("./computer.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      if (match?.state === state) afterMove(place(state, data), data);
    };
    worker.onerror = () => {
      void import("./computer").then(({ computerMove }) => {
        const edge = computerMove(state);
        if (edge && match?.state === state) afterMove(place(state, edge), edge);
      });
    };
    worker.postMessage(state);
  }, 390);
}
function startLocal() {
  close();
  clearRoom();
  const players = structuredClone(prefs.players);
  if (prefs.mode === "solo") players.Player2.initials = "CPU";
  match = { mode: prefs.mode, players, state: fresh({ ...prefs.size }) };
  save("match", match);
  notify("");
  game();
}
async function online(
  action: RoomAction | "restore",
  code = joinCode,
) {
  if (working) return;
  setBusy(true);
  notify({
    create: "Creating your room…",
    join: "Connecting to your friend’s room…",
    public: "Looking for a public match…",
    restore: "Reconnecting to your room…",
  }[action]);
  const token = ++roomGeneration;
  try {
    const mod = await import("./online");
    const session = await mod.enter(
      action,
      prefs.players.Player1,
      prefs.size,
      code,
      message => { if (token === roomGeneration) notify(message); },
    );
    if (token !== roomGeneration) {
      session.stop();
      return;
    }
    room = session;
    if (action !== "restore") save("match", null);
    notify("");
    if (hasInvite) {
      const url = new URL(location.href);
      url.searchParams.delete("room");
      const fragment = new URLSearchParams(url.hash.slice(1));
      if (fragment.has("room")) {
        fragment.delete("room");
        url.hash = fragment.toString();
      }
      history.replaceState({ ...history.state, boxGameInvite: true }, "", url);
    }
    session.watch((v) => {
      const previous = view,
        old = match,
        r = v.room;
      view = v;
      if (!r.players.player2) {
        drawWaiting();
        return;
      }
      if (
        dialog.open &&
        previous?.room.status === "finished" &&
        r.status === "active"
      )
        close();
      const diffs = old
        ? Object.keys(r.state.lines).filter((k) => !old.state.lines[k])
        : [];
      match = {
        mode: "online",
        players: { Player1: r.players.player1, Player2: r.players.player2 },
        state: r.state,
        last:
          diffs.at(-1) ??
          (Object.keys(r.state.lines).length ? old?.last : undefined),
      };
      game();
      if (dialog.open && dialog.classList.contains("result-dialog")) {
        const hint = dialog.querySelector(".rematch-hint");
        if (hint) hint.textContent = rematchHint();
        const again = dialog.querySelector<HTMLButtonElement>('[data-action="again"]');
        if (again) again.disabled = !canRematch();
      }
      if (diffs.length)
        note(
          !!old &&
            Object.keys(r.state.boxes).length >
              Object.keys(old.state.boxes).length,
        );
      if (
        r.status === "finished" &&
        previous &&
        previous.room.status !== "finished"
      )
        result();
    });
  } catch (e) {
    notify(roomFailure(e, action));
  } finally {
    setBusy(false);
  }
}
async function leaveGame() {
  cancelAI();
  roomGeneration++;
  // Another tab may have written a different local match to the shared save.
  if (match && match.mode !== "online" && JSON.stringify(read("match")) === JSON.stringify(match))
    save("match", null);
  const oldRoom = room;
  room = undefined;
  if (oldRoom) await oldRoom.leave();
  else clearRoom();
}
async function exit() {
  close();
  await leaveGame();
  setup();
  notify("");
}
document.addEventListener("change", (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.name === "room-action") {
    roomAction = input.value as RoomAction;
    notify("");
    roomFields();
  } else if (input.dataset.colorSide) {
    const side = input.dataset.colorSide as Side;
    const opponent = other(side);
    const color = input.value as Color;
    if (prefs.players[opponent].color === color) {
      const previous = prefs.players[side].color;
      prefs.players[opponent].color = previous;
      const swapped = document.querySelector<HTMLInputElement>(
        `input[name="color-${opponent}"][value="${previous}"]`,
      );
      if (swapped) {
        swapped.checked = true;
        $("#selected-" + opponent).textContent = previous;
      }
    }
    prefs.players[side].color = color;
    $("#selected-" + side).textContent = color;
    persist();
  }
});
document.addEventListener("submit", (e) => {
  if (e.target instanceof HTMLFormElement && e.target.id === "room-form") {
    e.preventDefault();
    void online(roomAction);
  }
});
document.addEventListener("invalid", (e) => {
  const input = e.target;
  if (input instanceof HTMLInputElement && input.id === "code") {
    input.setCustomValidity(roomMessages.invalidCode);
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "room-help room-feedback");
    notify(roomMessages.invalidCode);
  }
}, true);
document.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.player) {
    const p = prefs.players[input.dataset.player as Side];
    p.initials = initials(input.value);
    input.value = p.initials;
  }
  if (input.id === "code") {
    if (input.hasAttribute("aria-invalid")) {
      input.setCustomValidity("");
      input.removeAttribute("aria-invalid");
      input.setAttribute("aria-describedby", "room-help");
      notify("");
    }
    joinCode = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    input.value = joinCode;
  }
});
document.addEventListener("focusout", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset?.player) {
    const side = input.dataset.player as Side;
    prefs.players[side].initials ||= side === "Player1" ? "P1" : "P2";
    input.value = prefs.players[side].initials;
    persist();
  }
});
document.addEventListener("click", async (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>("button");
  if (!b || b.disabled) return;
  const { action, mode, step, edge } = b.dataset;
  unlock();
  try {
    if (mode) {
      const wasOnline = prefs.mode === "online";
      if (mode === "online" && prefs.mode !== "online") previousMode = prefs.mode;
      prefs.mode = mode as Mode;
      persist();
      if (wasOnline || mode === "online") {
        notify("");
        setup();
        $(mode === "online" ? "#online-title" : '[data-mode="online"]').focus();
      } else settings();
      return;
    }
    if (step) {
      const k = step.slice(0, -2) as keyof Size;
      prefs.size[k] = Math.min(
        10,
        Math.max(2, prefs.size[k] + Number(step.slice(-2))),
      );
      persist();
      settings();
      return;
    }
    if (edge && match) {
      focusEdge = edge;
      if (room) {
        await room.move(edge);
      } else if (
        match.mode === "local" ||
        match.state.currentPlayer === "Player1"
      ) {
        afterMove(place(match.state, edge), edge);
      }
      return;
    }
    switch (action) {
      case "apply-update":
        await applyUpdate(b);
        break;
      case "help":
        modal(
          "How to play",
          '<ol class="rules"><li><strong>Draw one line.</strong><p>Tap the space between two neighboring dots.</p></li><li><strong>Close a box.</strong><p>The fourth side claims the box for you, even if your opponent drew the other three. Take another turn.</p></li><li><strong>Claim the most boxes.</strong><p>When the board is full, the higher score wins.</p></li></ol><button class="primary" data-action="close">Got it</button>',
        );
        break;
      case "sound":
        prefs.sound = !prefs.sound;
        persist();
        soundUI();
        if (!prefs.sound) music.stop();
        else unlock();
        break;
      case "start":
        startLocal();
        break;
      case "share":
        await shareGame();
        break;
      case "share-invite":
        if (view?.room.status === "waiting") await shareGame(view.room.code);
        break;
      case "copy-link": {
        if (!view || view.room.status !== "waiting") break;
        const feedback = $("#invite-feedback");
        const url = publicRoomURL(view.room.code);
        try {
          await navigator.clipboard.writeText(url);
          feedback.textContent = "Invite link copied.";
        } catch {
          if (!feedback.isConnected) break;
          feedback.innerHTML = '<label for="manual-link">Select this invite link to copy it.</label><input id="manual-link" class="share-url" readonly value="' + esc(url) + '">';
          const field = $<HTMLInputElement>("#manual-link");
          field.focus();
          field.select();
        }
        break;
      }
      case "again":
        close();
        if (room) await room.rematch();
        else startLocal();
        break;
      case "resume-room":
        await online("restore", b.dataset.room);
        break;
      case "exit":
        if (
          screen === "waiting" ||
          (match && finished(match.state)) ||
          view?.room.status === "abandoned"
        )
          await exit();
        else
          modal(
            view ? "Leave this room?" : "Start a new game?",
            "<p>" +
              (view
                ? "Your opponent will see that you left."
                : "This will end your current match.") +
              '</p><button class="primary" data-action="confirm-exit">' +
              (view ? "Leave room" : "New game") +
              '</button><button class="plain" data-action="close">Keep playing</button>',
          );
        break;
      case "confirm-exit":
        await exit();
        break;
      case "close":
        close();
        break;
    }
  } catch (err) {
    notify(
      room ? roomFailure(err, "play") : err instanceof Error
        ? err.message
        : "Something interrupted the game. Please try again.",
    );
  }
});
async function shareGame(code?: string) {
  const url = code ? publicRoomURL(code) : publicGameURL;
  const text = code ? "Join my Box Game room with code " + code + "." : "Play Box Game with me.";
  if (await shareInvite({ title: "Box Game", text, url })) return;
  const email = "mailto:?subject=Box%20Game&body=" + encodeURIComponent(text + "\n\n" + url);
  modal(code ? "Share invite" : "Share Box Game",
    '<label for="share-url">Send this link to a friend</label><input id="share-url" class="share-url" readonly value="' +
    esc(url) + '"><a class="primary" href="' + esc(email) + '" autofocus>Share by email</a>',
  );
}
function savedMatchCode(code?: string) {
  const record = roomStore.readMatch(code) as { room?: { code?: string; status?: string } } | undefined;
  const room = record?.room;
  return room?.code && isRoomCode(room.code) && (room.status === "active" || room.status === "finished") ? room.code : undefined;
}
const afterUpdate = history.state?.setupAfterUpdate;
const saved = afterUpdate ? undefined : read<Match>("match");
if (afterUpdate) {
  const state = { ...history.state };
  delete state.setupAfterUpdate;
  history.replaceState(state, "");
}
if (
  !hasInvite &&
  !peerSave &&
  saved &&
  ["solo", "local"].includes(saved.mode) &&
  validPlayer(saved.players?.Player1) &&
  validPlayer(saved.players?.Player2) &&
  validState(saved.state)
) {
  match = saved;
  game();
  scheduleAI();
} else {
  if (peerSave) prefs.mode = "online";
  setup();
  if (peerSave) void online("restore", resumeCode ?? "");
}
