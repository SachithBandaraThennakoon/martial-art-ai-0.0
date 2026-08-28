import { API_BASE_URL } from "./api.js";

let accessToken = null;
let refreshPromise = null;
const tokenListeners = new Set();
const SESSION_HINT_KEY = "martial_art_ai_session_available";

function safeLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function hasRefreshSessionHint() {
  if (accessToken) return true;
  const storage = safeLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(SESSION_HINT_KEY) === "true";
  } catch {
    return false;
  }
}

function updateSessionHint(hasSession) {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    if (hasSession) {
      storage.setItem(SESSION_HINT_KEY, "true");
    } else {
      storage.removeItem(SESSION_HINT_KEY);
    }
  } catch {
    // Authentication still works in memory when browser storage is disabled.
  }
}

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || null;
  updateSessionHint(Boolean(accessToken));
  tokenListeners.forEach((listener) => listener(accessToken));
}

export function subscribeAccessToken(listener) {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    const requestRefresh = () => fetch(`${API_BASE_URL}/refresh`, {
      method: "POST",
      credentials: "include"
    })
      .then(async (response) => {
        if (!response.ok) {
          setAccessToken(null);
          return null;
        }
        const session = await response.json();
        setAccessToken(session.access_token);
        return session;
      })
      .catch(() => {
        setAccessToken(null);
        return null;
      });

    const coordinatedRefresh =
      typeof navigator !== "undefined" && navigator.locks?.request
        ? navigator.locks.request("martial-art-ai-refresh", requestRefresh)
        : requestRefresh();

    refreshPromise = coordinatedRefresh
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function authFetch(input, options = {}) {
  let token = getAccessToken();
  if (!token && hasRefreshSessionHint()) {
    const session = await refreshAccessToken();
    token = session?.access_token || null;
  }

  const request = (activeToken) => {
    const headers = new Headers(options.headers || {});
    if (activeToken) headers.set("Authorization", `Bearer ${activeToken}`);
    return fetch(input, {
      ...options,
      credentials: "include",
      headers
    });
  };

  let response = await request(token);
  if (response.status !== 401) return response;
  if (!hasRefreshSessionHint()) return response;

  const session = await refreshAccessToken();
  if (!session?.access_token) return response;
  response = await request(session.access_token);
  return response;
}

export async function endSession() {
  setAccessToken(null);
  try {
    await fetch(`${API_BASE_URL}/logout`, {
      method: "POST",
      credentials: "include"
    });
  } catch {
    // Local sign-out still succeeds if the service is temporarily unavailable.
  }
}

export function accessTokenExpiresAt(token = accessToken) {
  if (!token) return 0;
  try {
    const segment = token.split(".")[1];
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(atob(normalized));
    return Number(payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}
