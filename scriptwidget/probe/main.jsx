// Run baseline twice, then timeout, then (optionally) deadline and inspect.
// Change this value in the ScriptWidget editor; no credentials are needed.
const MODE = "baseline"; // baseline | timeout | deadline | inspect

const KEY = "telecom-probe-v1";
const started = Date.now();
const runtime = typeof $runtime === "undefined" ? {} : $runtime;
const storage = typeof $storage === "undefined" ? null : $storage;
const http = typeof $http === "undefined" ? null : $http;
const report = {
  mode: MODE,
  apiVersion: runtime.apiVersion || "not exposed",
  limitMs: runtime.limits ? runtime.limits.executionMilliseconds : null,
  family: typeof $getenv === "function" ? $getenv("widget-size") : "unknown",
  storage: "unavailable",
  previous: "none",
  previousCompleted: null,
  network: "not run",
  transport: "none",
  networkMs: null,
  outcome: "not run",
};

function elapsed() {
  return Date.now() - started;
}

function log(value) {
  if (typeof console !== "undefined" && typeof console.log === "function") {
    console.log(JSON.stringify(value));
  }
}

let state = {};
let writable = false;
let baseline = null;
try {
  if (storage && typeof storage.getString === "function" && typeof storage.setString === "function") {
    const raw = storage.getString(KEY);
    state = raw ? JSON.parse(raw) : {};
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("Invalid saved state");
    }
    baseline = state.baseline || null;
    if (state.attempt) {
      report.previous = state.attempt.mode + " / " + state.attempt.stage;
      report.previousCompleted = state.attempt.stage === "completed";
    }
    report.run = (Number(state.runs) || 0) + 1;
    state.runs = report.run;
    state.attempt = { mode: MODE, stage: "started", at: new Date().toISOString() };
    const encoded = JSON.stringify(state);
    const saved = storage.setString(KEY, encoded);
    writable = saved !== false && storage.getString(KEY) === encoded;
    report.storage = writable ? "read/write OK; run " + report.run : "write/readback failed";
  }
} catch (error) {
  report.storage = "error: " + String(error).slice(0, 100);
}

function checkpoint(stage) {
  if (!writable) return;
  state.attempt.stage = stage;
  state.attempt.elapsedMs = elapsed();
  try {
    if (storage.setString(KEY, JSON.stringify(state)) === false) {
      writable = false;
      report.storage = "checkpoint write failed";
    }
  } catch (error) {
    writable = false;
    report.storage = "checkpoint error: " + String(error).slice(0, 100);
  }
}

async function request(url, timeout) {
  const options = { timeoutInterval: timeout, headers: { Accept: "application/json" } };
  if (http && typeof http.getResponse === "function") {
    report.transport = "$http.getResponse";
    const response = await http.getResponse(url, options);
    if (response.status !== 200) throw new Error("HTTP " + response.status);
    return response.body;
  }
  if (http && typeof http.get === "function") {
    report.transport = "$http.get (no status metadata)";
    return await http.get(url, options);
  }
  throw new Error("No supported $http API");
}

if (["baseline", "timeout", "deadline", "inspect"].indexOf(MODE) === -1) {
  report.outcome = "invalid mode";
} else if (MODE === "inspect") {
  report.outcome = "inspection only";
} else {
  const delay = MODE === "timeout" ? 3 : MODE === "deadline" ? 7 : 0;
  const timeout = MODE === "timeout" ? 1 : MODE === "deadline" ? 10 : 3;
  // Nonce prevents an intermediary cache from skipping the intended delay.
  const url = "https://httpbingo.org/" + (delay ? "delay/" + delay : "get") + "?probe=" + started;
  checkpoint("waiting for network");
  log({ event: "request-start", mode: MODE, timeoutSeconds: timeout, delaySeconds: delay });
  const networkStarted = Date.now();
  try {
    const body = await request(url, timeout);
    report.networkMs = Date.now() - networkStarted;
    const parsed = JSON.parse(body);
    if (!parsed || !parsed.args || !parsed.headers || typeof parsed.url !== "string") {
      throw new Error("Unexpected JSON from probe service");
    }
    report.network = "HTTPS + JSON OK";
    report.outcome = MODE === "timeout" ? "timeout not enforced" : MODE === "deadline" ? "survived long request" : "success";
    if (MODE === "baseline") {
      state.baseline = { at: new Date().toISOString(), networkMs: report.networkMs };
      baseline = state.baseline;
    }
  } catch (error) {
    report.networkMs = Date.now() - networkStarted;
    report.network = "request failed";
    report.error = String(error).slice(0, 180);
    // A failure is NOT automatically a timeout: DNS, permission and service
    // errors can reject too. Inspect duration/error in the console.
    report.outcome = baseline ? "cached baseline retained" : "no cached baseline";
  }
}

report.cachedBaseline = baseline;
report.elapsedMs = elapsed();
checkpoint("completed");
log({ event: "probe-report", report: report });

// Native widget layout. Logic above is exercised with mocked host APIs.
const dark = typeof $device !== "undefined" && typeof $device.isdarkmode === "function"
  ? $device.isdarkmode() : true;
const background = dark ? "#111827" : "#f3f4f6";
const foreground = dark ? "#f9fafb" : "#111827";
const secondary = dark ? "#cbd5e1" : "#475569";
const versionLine = "API " + report.apiVersion + " · limit " + (report.limitMs == null ? "unknown" : report.limitMs + " ms");
const timeLine = report.networkMs == null ? report.outcome : report.outcome + " · " + report.networkMs + " ms";
const cacheLine = baseline ? "Cache: " + baseline.networkMs + " ms @ " + baseline.at : "Cache: none";

$render(
  <vstack frame="max" padding="12" spacing="4" alignment="leading" background={background}>
    <text font="headline" color={foreground}>Telecom probe · {MODE}</text>
    <text font="caption" color={secondary}>{versionLine}</text>
    <text font="caption" color={foreground}>{report.storage}</text>
    <text font="caption" color={foreground}>{timeLine}</text>
    <text font="caption2" color={secondary}>Previous: {report.previous}</text>
    <text font="caption2" color={secondary}>{cacheLine}</text>
    <text font="caption2" color={secondary}>Full report in console · {report.elapsedMs} ms</text>
  </vstack>
);
