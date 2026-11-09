const STORAGE_KEY = "relay-desk-connection-v1";
const ACTIVITY_KEY = "relay-desk-activity-v1";
const $ = (id) => document.getElementById(id);

const connectionForm = $("connectionForm");
const messageForm = $("messageForm");
const bridgeUrl = $("bridgeUrl");
const bridgeToken = $("bridgeToken");
const deviceLabel = $("deviceLabel");
const connectionState = $("connectionState");
const connectionStatus = $("connectionStatus");
const sendStatus = $("sendStatus");
const activityList = $("activityList");
const messageBody = $("messageBody");
const counter = $("counter");
const senderRoute = $("senderRoute");

let connection = load(STORAGE_KEY, null);
let activity = load(ACTIVITY_KEY, []);
let liveSocket = null;
let reconnectTimer = null;

function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function setStatus(element, message, kind = "") {
  element.textContent = message;
  element.dataset.kind = kind;
}

function normalizeUrl(value) {
  return value.trim().replace(/\/$/, "");
}

function currentSim() {
  return document.querySelector('input[name="sim"]:checked')?.value || "SIM1";
}

function setConnectionState(online, label) {
  connectionState.innerHTML = `<span class="state-dot ${online ? "online" : "offline"}"></span>${escapeHtml(label)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}

function addActivity(entry) {
  activity.unshift({ ...entry, at: new Date().toISOString() });
  activity = activity.slice(0, 30);
  save(ACTIVITY_KEY, activity);
  renderActivity();
}

function renderActivity() {
  if (!activity.length) {
    activityList.innerHTML = '<div class="empty">Connect a bridge to begin. Requests made from this browser appear here.</div>';
    return;
  }
  activityList.innerHTML = activity.map((item) => `
    <div class="activity-item">
      <span class="activity-badge ${item.kind === "error" ? "bad" : "good"}">${item.kind === "error" ? "!" : "✓"}</span>
      <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div>
      <time>${new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
    </div>
  `).join("");
}

async function bridgeFetch(path, options = {}) {
  if (!connection?.url || !connection?.token) throw new Error("Connect a bridge first");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${connection.url}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        "x-api-key": connection.token,
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!response.ok) throw new Error(body?.error || `Bridge returned HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function websocketUrl() {
  const url = new URL(connection.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = `?token=${encodeURIComponent(connection.token)}`;
  return url.toString();
}

function handleLiveEvent(event) {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === "relay.ready") {
    setConnectionState(true, `${connection.label || "Android bridge"} · live`);
    return;
  }
  if (message.type === "message.queued") {
    addActivity({ title: "SMS queued", detail: `${message.data.to} · ${message.data.sim} · another browser`, kind: "success" });
    return;
  }
  if (message.type === "message.status") {
    const detail = `${message.data.messageId} · ${message.data.eventName}${message.data.reason ? ` · ${message.data.reason}` : ""}`;
    addActivity({ title: "SMS status update", detail, kind: message.data.eventName === "FAILED" ? "error" : "success" });
    return;
  }
  if (message.type === "message.inbound") {
    addActivity({ title: "Incoming SMS", detail: `${message.data.from} · ${message.data.content.slice(0, 80)}`, kind: "success" });
  }
}

function connectLive() {
  if (!connection?.url || !connection?.token || typeof WebSocket === "undefined") return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (liveSocket) liveSocket.close();
  try {
    liveSocket = new WebSocket(websocketUrl());
    liveSocket.addEventListener("open", () => setConnectionState(true, `${connection.label || "Android bridge"} · live`));
    liveSocket.addEventListener("message", handleLiveEvent);
    liveSocket.addEventListener("error", () => setConnectionState(true, `${connection.label || "Android bridge"} · HTTP only`));
    liveSocket.addEventListener("close", () => {
      if (connection) {
        setConnectionState(true, `${connection.label || "Android bridge"} · reconnecting`);
        reconnectTimer = setTimeout(connectLive, 3000);
      }
    });
  } catch {
    reconnectTimer = setTimeout(connectLive, 3000);
  }
}

async function checkHealth({ quiet = false } = {}) {
  if (!connection?.url) {
    if (!quiet) setStatus(connectionStatus, "Connect a bridge first.", "error");
    return false;
  }
  try {
    const body = await bridgeFetch("/health");
    setConnectionState(true, `${connection.label || "Android bridge"} · online`);
    $("deviceName").textContent = connection.label || "Android bridge";
    $("deviceUrl").textContent = connection.url;
    if (!quiet) setStatus(connectionStatus, `Bridge online · ${body.outstanding ?? 0} outstanding`, "success");
    connectLive();
    return true;
  } catch (error) {
    setConnectionState(false, "Bridge unreachable");
    if (!quiet) setStatus(connectionStatus, error.message, "error");
    return false;
  }
}

connectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = normalizeUrl(bridgeUrl.value);
  if (!/^https?:\/\//i.test(url)) {
    setStatus(connectionStatus, "Bridge URL must start with http:// or https://", "error");
    return;
  }
  connection = { url, token: bridgeToken.value.trim(), label: deviceLabel.value.trim() || "Android bridge" };
  if (!connection.token) {
    setStatus(connectionStatus, "Enter a browser-scoped bridge token.", "error");
    return;
  }
  save(STORAGE_KEY, connection);
  setStatus(connectionStatus, "Checking bridge…");
  const online = await checkHealth();
  if (online) addActivity({ title: "Bridge connected", detail: connection.label, kind: "success" });
});

$("healthButton").addEventListener("click", () => checkHealth());
$("disconnectButton").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  connection = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (liveSocket) liveSocket.close();
  liveSocket = null;
  bridgeToken.value = "";
  setConnectionState(false, "Not connected");
  $("deviceName").textContent = "No device paired";
  $("deviceUrl").textContent = "Configure a bridge above";
  setStatus(connectionStatus, "Device connection forgotten.", "success");
});

messageBody.addEventListener("input", () => { counter.textContent = `${messageBody.value.length} / 1600`; });
document.querySelectorAll('input[name="sim"]').forEach((radio) => radio.addEventListener("change", () => { senderRoute.value = currentSim(); }));
senderRoute.addEventListener("change", () => { document.querySelector(`input[name="sim"][value="${senderRoute.value}"]`).checked = true; });

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(sendStatus, "");
  const to = $("recipient").value.trim();
  const body = messageBody.value.trim();
  const sim = senderRoute.value;
  if (!/^\+[1-9]\d{7,14}$/.test(to)) { setStatus(sendStatus, "Use an E.164 recipient such as +15551234567.", "error"); return; }
  if (!body) { setStatus(sendStatus, "Enter a message.", "error"); return; }
  if (!connection) { setStatus(sendStatus, "Connect a bridge before queueing SMS.", "error"); return; }

  const button = messageForm.querySelector("button[type=submit]");
  button.disabled = true;
  setStatus(sendStatus, "Queueing on bridge…");
  try {
    const result = await bridgeFetch("/bridge/messages", { method: "POST", body: JSON.stringify({ to, body, sim }) });
    setStatus(sendStatus, `Queued as ${result.id}. The Android app will fetch it when triggered.`, "success");
    addActivity({ title: "SMS queued", detail: `${to} · ${sim} · ${body.slice(0, 48)}`, kind: "success" });
    messageForm.reset();
    senderRoute.value = "SIM1";
    document.querySelector('input[name="sim"][value="SIM1"]').checked = true;
    counter.textContent = "0 / 1600";
  } catch (error) {
    setStatus(sendStatus, error.name === "AbortError" ? "Bridge request timed out." : error.message, "error");
    addActivity({ title: "SMS request failed", detail: error.message, kind: "error" });
  } finally {
    button.disabled = false;
  }
});

$("clearActivity").addEventListener("click", () => { activity = []; save(ACTIVITY_KEY, activity); renderActivity(); });

if (connection) {
  bridgeUrl.value = connection.url;
  deviceLabel.value = connection.label || "";
  checkHealth({ quiet: true });
}
renderActivity();
