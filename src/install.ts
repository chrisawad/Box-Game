type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type RelatedApp = { platform: string; id?: string; url?: string };
type InstallNavigator = Navigator & {
  standalone?: boolean;
  userAgentData?: { platform?: string };
  install?: () => Promise<void>;
  getInstalledRelatedApps?: () => Promise<RelatedApp[]>;
};

function mobilePlatform() {
  if ((navigator as InstallNavigator).userAgentData?.platform === "Android" || /Android/i.test(navigator.userAgent)) return "Android";
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iOS";
}

function isEmbeddedLaunch() {
  const url = new URL(location.href);
  const parts = url.hash.slice(1).split("&");
  const marked = parts.includes("from=games-dashboard");
  if (marked) {
    // Keep opaque deep links and room codes byte-for-byte intact.
    url.hash = parts.filter(part => part !== "from=games-dashboard").join("&");
    history.replaceState({ ...history.state, boxGameDashboard: true }, "", url);
  }
  const ua = navigator.userAgent;
  const platform = mobilePlatform();
  const webView = /;\s*wv\b|FBAN|FBAV|Instagram|Line\/|GSA\/|MicroMessenger/i.test(ua) ||
    (platform === "Android" && /Version\/4\.0.*Chrome\//.test(ua)) ||
    (platform === "iOS" && !/Safari\//.test(ua) && !(navigator as InstallNavigator).standalone);
  const dashboardReferrer = /^https:\/\/(games\.chrisawad\.com\/|chrisawad\.github\.io\/games-dashboard\/)/i.test(document.referrer);
  return marked || history.state?.boxGameDashboard === true ||
    window.self !== window.top || dashboardReferrer || webView;
}

export function setupInstall(
  button: HTMLButtonElement,
  dialog: HTMLDialogElement,
  gameURL: string,
  focusAfterInstall: () => void,
  canOffer: () => boolean,
) {
  const embedded = isEmbeddedLaunch();
  const nav = navigator as InstallNavigator;
  const appMode = matchMedia(
    "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)",
  );
  let prompt: InstallPrompt | undefined,
    relatedInstalled = false,
    installedHere = false,
    installApiFailed = false,
    busy = false,
    revision = 0;
  let shownThisVisit = false;
  let ready = false;
  let visit = 0;
  const hasInstallApi = () => !installApiFailed && typeof nav.install === "function";
  const isInstalled = () =>
    installedHere || relatedInstalled || (!embedded && (appMode.matches || nav.standalone === true));
  const reflect = () => {
    const installed = isInstalled();
    const showing = dialog.open && dialog.className === "install-dialog";
    if (installed && showing) dialog.close();
    if (installed && (showing || document.activeElement === button)) focusAfterInstall();
    button.hidden = installed;
    if (showing && !installed) updateActions();
    if (ready && !installed && !shownThisVisit && !dialog.open && canOffer()) open();
  };
  const checkRelated = async () => {
    const check = ++revision;
    try {
      if (!isSecureContext || !nav.getInstalledRelatedApps) return;
      const id = new URL("/", location.href).href;
      const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
      const apps = await nav.getInstalledRelatedApps();
      if (check !== revision) return;
      relatedInstalled = apps.some(
        (app) =>
          app.platform === "webapp" &&
          (app.url ? app.url === manifest : app.id === id),
      );
    } catch {
      /* Unavailable detection leaves a useful install/help action. */
    }
  };
  appMode.addEventListener("change", reflect);
  window.addEventListener("focus", () => {
    if (ready) void checkRelated().then(reflect);
  });
  window.addEventListener("appinstalled", () => {
    revision++;
    installedHere = true;
    prompt = undefined;
    reflect();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    // Fresh browser eligibility also covers uninstalling during this session.
    revision++;
    relatedInstalled = false;
    installedHere = false;
    reflect();
  });
  const nativeAvailable = () => isSecureContext && (hasInstallApi() || !!prompt || busy);
  function updateActions() {
    const install = dialog.querySelector<HTMLButtonElement>("#native-install")!;
    install.hidden = !nativeAvailable();
    install.setAttribute("aria-disabled", String(busy));
    install.textContent = busy ? "Installing…" : "Install app";
    dialog.querySelector<HTMLElement>("#install-manually")!.hidden = !embedded && nativeAvailable();
  }
  async function request() {
    if (busy || isInstalled() || !nativeAvailable()) return;
    const status = dialog.querySelector<HTMLElement>("#install-status")!;
    status.textContent = "";
    busy = true;
    updateActions();
    try {
      if (hasInstallApi() && nav.install) {
        await nav.install();
        installedHere = true;
      } else if (prompt) {
        const pending = prompt;
        prompt = undefined;
        await pending.prompt();
        if ((await pending.userChoice).outcome === "accepted") installedHere = true;
        else status.textContent = "Installation canceled. You can keep playing here.";
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        status.textContent = "Installation canceled. You can keep playing here.";
      } else {
        if (hasInstallApi()) installApiFailed = true;
        status.textContent = "The installer could not open. Try again or use your browser’s install menu.";
      }
    } finally {
      busy = false;
      reflect();
    }
  }
  function open() {
    if (isInstalled() || dialog.open) return;
    dialog.className = "install-dialog";
    dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">Install Boxes</h2></div>
      <p>Keep Boxes on your home screen and play offline after your first visit.</p>
      <div id="install-manually">${installSteps(embedded, gameURL)}
        <details ${embedded ? "open" : ""}><summary>Copy the game link</summary>
          <input class="share-url" aria-label="Game link" readonly>
          <button class="plain" id="copy-install-link">Copy link</button>
          <p role="status" id="copy-status"></p>
        </details>
      </div>
      <button class="primary" id="native-install"></button><p role="status" id="install-status"></p>
      <button class="plain" data-action="close">Not now</button>`;
    const field = dialog.querySelector("input")!;
    field.value = gameURL;
    field.onfocus = () => field.select();
    dialog.querySelector<HTMLButtonElement>("#copy-install-link")!.onclick = async () => {
      const status = dialog.querySelector<HTMLElement>("#copy-status")!;
      try {
        await navigator.clipboard.writeText(gameURL);
        status.textContent = "Link copied.";
      } catch {
        field.focus();
        field.select();
        status.textContent = "Use your device’s Copy command to copy the selected link.";
      }
    };
    const install = dialog.querySelector<HTMLButtonElement>("#native-install")!;
    install.onclick = request;
    updateActions();
    install.autofocus = nativeAvailable() && !embedded;
    dialog.showModal();
    shownThisVisit = true;
  }
  button.addEventListener("click", open);
  dialog.addEventListener("close", reflect);
  function startVisit() {
    const current = ++visit;
    ready = false;
    shownThisVisit = dialog.open && dialog.className === "install-dialog";
    const offer = () => {
      if (visit !== current) return;
      ready = true;
      reflect();
    };
    // An embedded browser can leave this lookup pending indefinitely.
    const deadline = window.setTimeout(offer, 600);
    void checkRelated().then(() => {
      clearTimeout(deadline);
      offer();
    });
  }
  startVisit();
  window.addEventListener("pageshow", event => { if (event.persisted) startVisit(); });
}

function installSteps(embedded: boolean, url: string) {
  const game = isSecureContext ? "Boxes" : `<a href="${url}">Boxes</a>`;
  switch (mobilePlatform()) {
    case "iOS":
      return `<ol class="rules"><li>${embedded
        ? "Use <strong>Open in Safari</strong> in this window’s menu, or copy the game link below and open it in Safari. Tap <strong>Share</strong>."
        : `Open ${game} in Safari and tap <strong>Share</strong>.`}</li>
        <li>Choose <strong>Add to Home Screen</strong>. Turn on <strong>Open as Web App</strong> if offered, then tap <strong>Add</strong>.</li></ol>`;
    case "Android":
      return `<ol class="rules"><li>${embedded
        ? "Choose <strong>Open in Chrome</strong> in this window’s menu, or copy the game link below and open it in Chrome."
        : `Open ${game} in Chrome.`}</li>
        <li>Tap Chrome’s <strong>⋮ menu</strong>, choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, and follow the prompt.</li></ol>`;
    default:
      if (!isSecureContext) return `<p>To install from this preview, open <a href="${url}">Boxes over HTTPS</a>.</p>`;
      if (/Macintosh/.test(navigator.userAgent) && /Version\/.*Safari\//.test(navigator.userAgent))
        return "<p>In Safari, choose <strong>File → Add to Dock</strong>, then select <strong>Add</strong>.</p>";
      return "<p>Open Boxes in Chrome or Edge and choose the <strong>install option</strong> in the address bar or browser menu.</p>";
  }
}
