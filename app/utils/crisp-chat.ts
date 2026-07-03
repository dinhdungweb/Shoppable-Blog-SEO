const CRISP_WEBSITE_ID = "b882709c-9f60-4bf7-b823-0f6bc6196f4a";
const CRISP_SCRIPT_SELECTOR = 'script[data-crisp-chat="true"]';
const CRISP_LOAD_DELAY_MS = 5000;
const CRISP_IDLE_TIMEOUT_MS = 8000;

declare global {
  interface Window {
    $crisp?: unknown[];
    CRISP_WEBSITE_ID?: string;
    __sbsCrispShop?: string;
  }
}

let crispLoadPromise: Promise<boolean> | undefined;

function canUseDOM() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function setCrispGlobals(shop?: string) {
  window.$crisp = window.$crisp || [];
  window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;

  if (shop && window.__sbsCrispShop !== shop) {
    (window.$crisp as unknown[][]).push(["set", "session:data", [[["shop", shop]]]]);
    window.__sbsCrispShop = shop;
  }
}

export function loadCrispChat(shop?: string) {
  if (!canUseDOM()) return Promise.resolve(false);

  setCrispGlobals(shop);

  if (document.querySelector(CRISP_SCRIPT_SELECTOR)) {
    return Promise.resolve(true);
  }

  if (crispLoadPromise) return crispLoadPromise;

  crispLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://client.crisp.chat/l.js";
    script.async = true;
    script.dataset.crispChat = "true";
    script.onload = () => resolve(true);
    script.onerror = () => {
      crispLoadPromise = undefined;
      reject(new Error("Failed to load Crisp chat"));
    };

    document.head.appendChild(script);
  });

  return crispLoadPromise;
}

export function scheduleCrispChatLoad(shop?: string) {
  if (!canUseDOM()) return () => {};

  setCrispGlobals(shop);

  let timeoutId: number | undefined;
  let idleCallbackId: number | undefined;

  const loadWhenReady = () => {
    loadCrispChat(shop).catch(() => {});
  };

  const win = window as any;
  if (win.requestIdleCallback) {
    idleCallbackId = win.requestIdleCallback(loadWhenReady, {
      timeout: CRISP_IDLE_TIMEOUT_MS,
    });
  } else {
    timeoutId = window.setTimeout(loadWhenReady, CRISP_LOAD_DELAY_MS);
  }

  return () => {
    if (idleCallbackId && win.cancelIdleCallback) {
      win.cancelIdleCallback(idleCallbackId);
    }

    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  };
}

export function openCrispChat(shop?: string) {
  if (!canUseDOM()) return;

  setCrispGlobals(shop);
  (window.$crisp as unknown[][])?.push(["do", "chat:open"]);
  loadCrispChat(shop).catch(() => {});
}
