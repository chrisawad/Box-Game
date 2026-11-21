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
import { boardHtml, esc, fallbackArt, frame, icon, logo } from "./ui";
import { installInstructions, setupInstall } from "./install";
import { createWinCelebration } from "./celebration";
import { createWinAudio } from "./win-audio";
import type { OnlineView, Session } from "./online";

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
const incomingCode = (new URL(location.href).searchParams.get("room") ?? "")
  .trim()
  .toUpperCase();
const hasInvite = /^[A-HJ-NP-Z2-9]{6}$/.test(incomingCode);
if (hasInvite) prefs.mode = "online";
let screen: "setup" | "game" | "waiting" = "setup",
  joinCode = hasInvite ? incomingCode : "",
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
  $("#notice").textContent = m;
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
  '<header><div class="brand">' +
  logo +
  '<span>Box Game<span class="period">.</span></span></div><nav><button class="plain help-button" data-action="help">' +
  icon("help") +
  '<span>How to play</span></button><button class="round" id="sound" data-action="sound"></button></nav></header><section id="surface"></section><footer><div id="install-wrap" hidden><div class="install-copy"><b>Install Box Game</b><small>Play solo or local games offline.</small></div><button class="install" id="install" hidden>' +
  icon("install") +
  ' Install game</button><button id="skip-install" class="round" aria-label="Dismiss install offer">' +
  icon("close") +
  '</button></div><span id="notice" role="status"></span><button class="plain" id="update" hidden>Update game</button></footer>';
function soundUI() {
  const b = $("#sound");
  b.innerHTML = icon(prefs.sound ? "sound" : "mute");
  b.setAttribute("aria-label", prefs.sound ? "Mute sound" : "Enable sound");
  b.setAttribute("aria-pressed", String(prefs.sound));
}
soundUI();
function modal(title: string, body: string) {
  if (dialog.open) dialog.close();
  dialog.className = "";
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
const installFlow = setupInstall(
  $<HTMLButtonElement>("#install"),
  () => modal("Install Box Game", installInstructions()),
  notify,
  () => $<HTMLButtonElement>(".help-button").focus(),
);
let dismissed = false;
try {
  dismissed = sessionStorage.getItem("box-game.install-offered") === "1";
} catch {}
function reflectInstall() {
  const box = $("#install-wrap");
  box.hidden = installFlow.isInstalled();
  box.classList.toggle("offer", !dismissed);
}
$("#skip-install").onclick = () => {
  dismissed = true;
  try {
    sessionStorage.setItem("box-game.install-offered", "1");
  } catch {}
  reflectInstall();
  $("#install").focus();
};
new MutationObserver(reflectInstall).observe($("#install"), {
  attributes: true,
  attributeFilter: ["hidden"],
});
void installFlow.ready.then(reflectInstall);
const updateSW = registerSW({
  onNeedRefresh() {
    $("#update").hidden = false;
  },
});
$("#update").onclick = () => void updateSW(true);
const modes = { solo: "Solo", local: "Local", online: "Online" };
const modeHelp = {
  solo: "Face the computer. Watch for long chains.",
  local: "Two players share one screen and take turns.",
  online: "Play a friend by code or find a public game.",
};
const names: Side[] = ["Player1", "Player2"];
function playerInput(side: Side) {
  const p = prefs.players[side],
    cpu = prefs.mode === "solo" && side === "Player2";
  const label =
    side === "Player2"
      ? cpu
        ? "Computer"
        : "Player 2"
      : prefs.mode === "local"
        ? "Player 1"
        : "You";
  return (
    '<div class="player-row"><button class="color-disc" style="--ink:' +
    colors[p.color] +
    '" data-color="' +
    side +
    '" aria-label="Choose ' +
    (label === "You" ? "your" : label.toLowerCase()) +
    ' color">' +
    (cpu ? icon("solo") : icon("edit")) +
    '</button><div><label for="' +
    side +
    '">' +
    label +
    "</label>" +
    (cpu
      ? "<strong>CPU</strong>"
      : '<input id="' +
        side +
        '" data-player="' +
        side +
        '" aria-label="' +
        (label === "You" ? "Your" : label) +
        ' initials" value="' +
        esc(p.initials) +
        '" maxlength="6" autocomplete="off" spellcheck="false">') +
    "</div></div>"
  );
}
function stepper(key: keyof Size) {
  const n = prefs.size[key];
  return (
    '<div class="step"><button data-step="' +
    key +
    '-1" aria-label="Fewer ' +
    key +
    '" ' +
    (n <= 2 ? "disabled" : "") +
    '>−</button><span aria-label="' +
    key +
    '">' +
    n +
    '</span><button data-step="' +
    key +
    '+1" aria-label="More ' +
    key +
    '" ' +
    (n >= 10 ? "disabled" : "") +
    ">+</button></div>"
  );
}
function settings() {
  const online = prefs.mode === "online";
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
    '</p><div class="field-head"><h3>Players</h3><span>Initials &amp; colors</span></div><div class="player-list">' +
    playerInput("Player1") +
    (online ? "" : playerInput("Player2")) +
    '</div><div class="field-head"><h3>Board size</h3><span>' +
    prefs.size.rows * prefs.size.columns +
    ' boxes</span></div><div class="dimensions">' +
    stepper("columns") +
    "<span>×</span>" +
    stepper("rows") +
    "</div>" +
    (online
      ? '<button class="primary" data-action="public">' +
        icon("online") +
        ' Find public game</button><div class="private-tools"><button class="secondary" data-action="create">Create private room</button><div><input aria-label="Room code" id="code" placeholder="Room code" maxlength="6" value="' +
        esc(joinCode) +
        '"><button data-action="join">Join</button></div></div>'
      : '<button class="primary" data-action="start">' +
        icon("start") +
        " Start game</button>");
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
  $("#surface").innerHTML =
    '<section class="waiting panel"><div class="waiting-mark">' +
    icon("online") +
    '</div><div class="kicker">ONLINE ROOM</div><h1>' +
    (r.status === "abandoned"
      ? "Room closed"
      : r.public
        ? "Finding a player…"
        : "Waiting for a friend") +
    "</h1><p>" +
    (r.status === "abandoned"
      ? "A player left this room."
      : r.public
        ? "Another player looking for this board size can join you."
        : "Keep this room open. Your friend can join by code, invite link, or QR.") +
    '</p><strong class="room-code">' +
    esc(r.code) +
    '</strong><button class="secondary" data-action="copy">Copy room code</button><div class="share-tools"><button class="secondary" data-action="link">Copy invite link</button><button class="secondary" data-action="qr">Show QR code</button></div><button class="plain" data-action="exit">Leave room</button></section>';
}
function titleOf(m: Match) {
  const a = score(m.state, "Player1"),
    b = score(m.state, "Player2");
  return a === b
    ? "It’s a tie!"
    : m.players[a > b ? "Player1" : "Player2"].initials + " wins!";
}
function canRematch() {
  return (
    !view ||
    (view.room.rematchRequester === view.seat &&
      !!view.room.players.player1.connected &&
      !!view.room.players.player2?.connected &&
      view.connected)
  );
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
  $("#surface").innerHTML =
    '<div class="match-layout"><section class="match-meta panel"><div class="kicker"><span></span>' +
    subtitle +
    '</div><h1>Scoreboard</h1><div class="scores">' +
    scores +
    '</div><div class="turn" role="status" style="--ink:' +
    colors[player.color] +
    '"><i></i>' +
    esc(message) +
    '</div><div class="match-detail">' +
    icon("grid") +
    s.board.columns +
    " × " +
    s.board.rows +
    " board</div>" +
    (view
      ? '<div class="transport">' +
        (view.direct ? "PeerJS · WebRTC" : "Waiting for connection") +
        "</div>"
      : "") +
    (over && canRematch()
      ? '<button class="primary" data-action="again">Play again</button>'
      : "") +
    '<button class="secondary" data-action="exit">' +
    (view ? "Leave room" : "New game") +
    '</button></section><section class="play-area">' +
    boardHtml(s, m.players, locked, m.last) +
    '<div class="progress-row"><span>' +
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
      (canRematch()
        ? '<button class="primary" data-action="again">Play again</button>'
        : "<p>Your opponent can start the rematch.</p>") +
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
  try {
    sessionStorage.removeItem("box-game.peer-room.v1");
  } catch {}
  const players = structuredClone(prefs.players);
  if (prefs.mode === "solo") players.Player2.initials = "CPU";
  match = { mode: prefs.mode, players, state: fresh({ ...prefs.size }) };
  save("match", match);
  notify("");
  game();
}
async function online(
  action: "create" | "join" | "public" | "restore",
  code = joinCode,
) {
  if (working) return;
  setBusy(true);
  notify(action === "restore" ? "Reconnecting to room…" : "Connecting…");
  const token = ++roomGeneration;
  try {
    const mod = await import("./online");
    const session = await mod.enter(
      action,
      prefs.players.Player1,
      prefs.size,
      code,
    );
    if (token !== roomGeneration) {
      session.stop();
      return;
    }
    room = session;
    save("match", null);
    notify("");
    if (hasInvite) {
      const url = new URL(location.href);
      url.searchParams.delete("room");
      history.replaceState(null, "", url);
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
    }, notify);
  } catch (e) {
    if (action === "restore") notify("Reconnect by opening this room again.");
    notify(
      e instanceof Error ? e.message : "Could not open the room. Try again.",
    );
  } finally {
    setBusy(false);
  }
}
async function exit() {
  close();
  cancelAI();
  roomGeneration++;
  const oldRoom = room;
  room = undefined;
  if (oldRoom) await oldRoom.leave();
  save("match", null);
  setup();
  notify("");
}
function palette(side: Side) {
  const p = prefs.players[side];
  modal(
    "Choose a color",
    '<div class="palette">' +
      Object.entries(colors)
        .map(
          ([name, hex]) =>
            '<button data-pick="' +
            name +
            '" data-side="' +
            side +
            '" aria-pressed="' +
            (name === p.color) +
            '" style="--ink:' +
            hex +
            '"><i>' +
            (name === p.color ? "✓" : "") +
            "</i>" +
            name +
            "</button>",
        )
        .join("") +
      "</div>",
  );
}
document.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.player) {
    const p = prefs.players[input.dataset.player as Side];
    p.initials = initials(input.value);
    input.value = p.initials;
  }
  if (input.id === "code") {
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
  const { action, mode, step, color, pick, side, edge } = b.dataset;
  unlock();
  try {
    if (mode) {
      prefs.mode = mode as Mode;
      persist();
      settings();
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
    if (color) {
      palette(color as Side);
      return;
    }
    if (pick && side) {
      const p = side as Side,
        op = other(p);
      if (prefs.players[op].color === pick)
        prefs.players[op].color = prefs.players[p].color;
      prefs.players[p].color = pick as Color;
      persist();
      close();
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
      case "public":
      case "join":
      case "create":
        await online(action);
        break;
      case "copy":
        if (view) {
          try {
            await navigator.clipboard.writeText(view.room.code);
            notify("Room code copied.");
          } catch {
            notify("Share room code " + view.room.code + ".");
          }
        }
        break;
      case "link":
        if (view) {
          const url = inviteUrl(view.room.code);
          try {
            await navigator.clipboard.writeText(url);
            notify("Invite link copied.");
          } catch {
            modal(
              "Invite link",
              '<p><a href="' + esc(url) + '">' + esc(url) + "</a></p>",
            );
          }
        }
        break;
      case "qr":
        if (view) {
          const code = view.room.code,
            url = inviteUrl(code);
          const { toDataURL } = await import("qrcode");
          const img = await toDataURL(url, {
            width: 320,
            margin: 4,
            errorCorrectionLevel: "M",
            color: { dark: "#292038", light: "#ffffff" },
          });
          if (view?.room.code === code)
            modal(
              "Scan to join",
              '<img class="qr" src="' +
                img +
                '" alt="QR code for room ' +
                code +
                '"><p class="qr-caption">Scan with your phone camera or enter <strong>' +
                code +
                "</strong>.</p>",
            );
        }
        break;
      case "again":
        close();
        if (room) await room.rematch();
        else startLocal();
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
      err instanceof Error
        ? err.message
        : "Something interrupted the game. Please try again.",
    );
  }
});
function inviteUrl(code: string) {
  const url = new URL("./", location.href);
  url.searchParams.set("room", code);
  return url.href;
}
const saved = read<Match>("match");
let peerSave = false;
try {
  peerSave = !!sessionStorage.getItem("box-game.peer-room.v1");
} catch {}
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
  setup();
  if (peerSave && !hasInvite) void online("restore");
  if (hasInvite) notify("Invite ready. Choose your initials and tap Join.");
}
