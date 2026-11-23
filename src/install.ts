type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type RelatedApp = { platform: string; id?: string; url?: string };
type InstallNavigator = Navigator & {
  standalone?: boolean;
  install?: () => Promise<void>;
  getInstalledRelatedApps?: () => Promise<RelatedApp[]>;
};

export function setupInstall(
  button: HTMLButtonElement,
  help: () => void,
  status: (message: string) => void,
  focusAfterInstall: () => void,
  onChange: (installed: boolean) => void,
) {
  const nav = navigator as InstallNavigator;
  const appMode = matchMedia(
    "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)",
  );
  const storageKey = "box-game.installed";
  let remembered = false;
  try {
    remembered = localStorage.getItem(storageKey) === "1";
  } catch {}
  function remember(value: boolean) {
    remembered = value;
    try {
      if (value) localStorage.setItem(storageKey, "1");
      else localStorage.removeItem(storageKey);
    } catch {}
  }
  let prompt: InstallPrompt | undefined,
    relatedInstalled = false,
    revision = 0,
    checked = false;
  const isInstalled = () =>
    appMode.matches ||
    nav.standalone === true ||
    relatedInstalled ||
    remembered;
  const reflect = () => {
    if (!checked) return;
    const installed = isInstalled();
    if (installed && document.activeElement === button) focusAfterInstall();
    onChange(installed);
  };
  const checkRelated = async () => {
    if (!isSecureContext || !nav.getInstalledRelatedApps) return;
    const check = ++revision;
    try {
      const id = new URL("/", location.href).href;
      const manifest = new URL("manifest.webmanifest", document.baseURI).href;
      const apps = await nav.getInstalledRelatedApps();
      if (check !== revision) return;
      relatedInstalled = apps.some(
        (app) =>
          app.platform === "webapp" &&
          (app.url ? app.url === manifest : app.id === id),
      );
      reflect();
    } catch {
      /* Unavailable detection leaves a useful install/help action. */
    }
  };
  function displayChanged() {
    if (appMode.matches || nav.standalone) remember(true);
    reflect();
  }
  appMode.addEventListener("change", displayChanged);
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    revision++;
    remembered = event.newValue === "1";
    relatedInstalled = false;
    reflect();
  });
  window.addEventListener("focus", () => {
    if (checked) void checkRelated();
  });
  window.addEventListener("appinstalled", () => {
    revision++;
    remember(true);
    prompt = undefined;
    reflect();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    // Fresh browser eligibility also covers uninstalling during this session.
    revision++;
    relatedInstalled = false;
    if (remembered) remember(false);
    reflect();
  });
  const request = async () => {
    if (isInstalled() || button.getAttribute("aria-disabled") === "true") return;
    // Call supported install APIs directly in this user gesture.
    if (!isSecureContext || (!nav.install && !prompt)) {
      help();
      return;
    }
    button.setAttribute("aria-disabled", "true");
    try {
      if (nav.install) {
        await nav.install();
        remember(true);
      } else if (prompt) {
        const pending = prompt;
        prompt = undefined;
        await pending.prompt();
        if ((await pending.userChoice).outcome === "accepted") remember(true);
        else status("Installation canceled. You can install later.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        status("Installation canceled. You can install later.");
      else help();
    } finally {
      button.removeAttribute("aria-disabled");
      reflect();
    }
  };
  button.addEventListener("click", request);
  displayChanged();
  void checkRelated().then(() => {
    checked = true;
    reflect();
  });
  return { request };
}

export function installInstructions() {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  if (platform === "Android" || /Android/i.test(navigator.userAgent))
    return `<ol class="rules">
      <li><strong>Open the game in Chrome.</strong><p>If Play opened a window inside the Games Dashboard, tap its menu (⋮) and choose <strong>Open in Chrome</strong> or <strong>Open in browser</strong>. Choose Chrome if asked. If that option is missing, use <strong>Copy game link</strong> below, open Chrome, and paste the link into its address bar.</p></li>
      <li><strong>Install from Chrome.</strong><p>Tap Chrome’s menu (⋮). Choose <strong>Install app</strong>, <strong>Install and create shortcut</strong>, or <strong>Add to Home screen</strong>, then confirm.</p></li>
    </ol><p><strong>Already installed?</strong> Swipe up from your Android home screen to open the app drawer. Search for <strong>Box Game</strong> and tap its icon to play.</p>`;
  const appleMobile =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (appleMobile)
    return "<p>Open the game in <strong>Safari</strong>. If you’re in another app, copy the game link below and paste it into Safari.</p><p>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Turn on <strong>Open as Web App</strong> if offered, then tap <strong>Add</strong>.</p><p><strong>Already installed?</strong> Tap <strong>Box Game</strong> on your Home Screen or find it in the App Library.</p>";
  const mac = platform === "macOS" || /Mac/.test(navigator.platform);
  return "<p>Open the game in Chrome or Edge. Select the install icon in the address bar, or find the app installation option in your browser’s menu and confirm.</p>" +
    (mac ? "<p>In Safari on Mac, choose <strong>File</strong> → <strong>Add to Dock</strong>.</p>" : "") +
    "<p><strong>Already installed?</strong> Search your device’s apps for <strong>Box Game</strong> and open it.</p>";
}
