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

export function installLaunchContext() {
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
  const embedded = marked || history.state?.boxGameDashboard === true ||
    window.self !== window.top || dashboardReferrer || webView;
  // Custom tabs can have the same user agent as the full mobile browser.
  return { embedded, mobile: !!platform };
}

export function setupInstall(
  button: HTMLButtonElement,
  embedded: boolean,
  help: () => void,
  status: (message: string) => void,
  focusAfterInstall: () => void,
  onChange: (installed: boolean, nativeAvailable: boolean) => void,
) {
  const nav = navigator as InstallNavigator;
  const appMode = matchMedia(
    "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)",
  );
  let prompt: InstallPrompt | undefined,
    relatedInstalled = false,
    installedHere = false,
    installApiFailed = false,
    revision = 0;
  const hasInstallApi = () => !installApiFailed && typeof nav.install === "function";
  const isInstalled = () =>
    installedHere || relatedInstalled || (!embedded && (appMode.matches || nav.standalone === true));
  const reflect = () => {
    const installed = isInstalled();
    if (installed && document.activeElement === button) focusAfterInstall();
    onChange(installed, isSecureContext && (!!prompt || hasInstallApi()));
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
    void checkRelated().then(reflect);
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
  const request = async () => {
    if (isInstalled() || button.getAttribute("aria-disabled") === "true") return;
    // Call supported install APIs directly in this user gesture.
    if (!isSecureContext || (!hasInstallApi() && !prompt)) {
      help();
      return;
    }
    button.setAttribute("aria-disabled", "true");
    try {
      if (hasInstallApi() && nav.install) {
        await nav.install();
        installedHere = true;
      } else if (prompt) {
        const pending = prompt;
        prompt = undefined;
        await pending.prompt();
        if ((await pending.userChoice).outcome === "accepted") installedHere = true;
        else status("Installation canceled. You can install later.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        status("Installation canceled. You can install later.");
      else {
        if (hasInstallApi()) installApiFailed = true;
        help();
      }
    } finally {
      button.removeAttribute("aria-disabled");
      reflect();
    }
  };
  button.addEventListener("click", request);
  // Allow a quick positive lookup to settle without blocking help on a stalled lookup.
  const deadline = window.setTimeout(reflect, 600);
  void checkRelated().then(() => {
    clearTimeout(deadline);
    reflect();
  });
  return { request };
}

export function installInstructions() {
  const platform = (navigator as InstallNavigator).userAgentData?.platform;
  const mobile = mobilePlatform();
  if (mobile === "Android")
    return `<ol class="rules">
      <li><strong>Open the game in Chrome.</strong><p>If you’re in the Games Dashboard or another app, open its menu (⋮) and choose <strong>Open in Chrome</strong> or <strong>Open in browser</strong>. Choose Chrome if asked. If that option is missing, use <strong>Copy game link</strong> below, open Chrome, and paste the link into its address bar.</p></li>
      <li><strong>Install from Chrome.</strong><p>Tap Chrome’s menu (⋮). Choose <strong>Install app</strong>, <strong>Install and create shortcut</strong>, or <strong>Add to Home screen</strong>, then confirm.</p></li>
    </ol><p><strong>Already installed?</strong> Swipe up from your Android home screen to open the app drawer. Search for <strong>Box Game</strong> and tap its icon to play.</p>`;
  if (mobile === "iOS")
    return "<p>Open the game in <strong>Safari</strong>. If you’re in another app, copy the game link below and paste it into Safari.</p><p>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Turn on <strong>Open as Web App</strong> if offered, then tap <strong>Add</strong>.</p><p><strong>Already installed?</strong> Tap <strong>Box Game</strong> on your Home Screen or find it in the App Library.</p>";
  const mac = platform === "macOS" || /Mac/.test(navigator.platform);
  return "<p>Open the game in Chrome or Edge. Select the install icon in the address bar, or find the app installation option in your browser’s menu and confirm.</p>" +
    (mac ? "<p>In Safari on Mac, choose <strong>File</strong> → <strong>Add to Dock</strong>.</p>" : "") +
    "<p><strong>Already installed?</strong> Search your device’s apps for <strong>Box Game</strong> and open it.</p>";
}
