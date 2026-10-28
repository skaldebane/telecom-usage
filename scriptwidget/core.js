// Shared source bundled into each standalone package. No browser/Node APIs.
const Telecom = (() => {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function number(value) {
    if (value == null || value === "" || typeof value === "boolean") return null;
    const n = Number(String(value).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  function config(input) {
    const c = Object.assign({ headline: "used", dataSource: "auto", appearance: "auto", accentColor: "", label: "",
      showPace: true, showTopups: false, showCallsSms: true, decimalPlaces: 1,
      selection: "", quotaGBOverride: null, minimumFetchIntervalMinutes: 15,
      staleAfterMinutes: 60, networkBudgetMs: 3500 }, input);
    if (["used", "remaining"].indexOf(c.headline) < 0) throw new Error("Invalid headline setting");
    if (["auto", "plan", "topups"].indexOf(c.dataSource) < 0) throw new Error("Invalid dataSource setting");
    if (["auto", "light", "dark"].indexOf(c.appearance) < 0) throw new Error("Invalid appearance setting");
    if (c.accentColor && !/^#[0-9a-f]{6}$/i.test(c.accentColor)) throw new Error("Accent must be #RRGGBB");
    c.decimalPlaces = Math.round(clamp(number(c.decimalPlaces) || 0, 0, 2));
    c.networkBudgetMs = clamp(number(c.networkBudgetMs) || 3500, 2000, 3500);
    c.minimumFetchIntervalMinutes = clamp(number(c.minimumFetchIntervalMinutes) || 0, 0, 1440);
    c.staleAfterMinutes = clamp(number(c.staleAfterMinutes) || 60, 1, 1440);
    c.selection = String(c.selection || "").trim();
    c.label = String(c.label || "").slice(0, 24);
    c.quotaGBOverride = number(c.quotaGBOverride);
    return c;
  }
  function instanceConfig(base, raw) {
    // Instance parameters are inputs, never persisted settings. In particular,
    // credentials/selection/quota cannot change the shared account identity.
    if (raw == null || String(raw).trim() === "") return config(base);
    if (typeof raw !== "string" || raw.length > 4096) throw new Error("Parameter must be a JSON object under 4096 characters");
    let overrides;
    try { overrides = JSON.parse(raw); }
    catch (_) { throw new Error("Parameter is not valid JSON. Use double quotes."); }
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("Parameter must be a JSON object");
    const types = { headline: "string", dataSource: "string", appearance: "string", accentColor: "string", label: "string",
      showPace: "boolean", showTopups: "boolean", showCallsSms: "boolean", decimalPlaces: "number",
      minimumFetchIntervalMinutes: "number", staleAfterMinutes: "number", networkBudgetMs: "number" };
    const ranges = { decimalPlaces: [0, 2], minimumFetchIntervalMinutes: [0, 1440],
      staleAfterMinutes: [1, 1440], networkBudgetMs: [2000, 3500] };
    for (const key of Object.keys(overrides)) {
      if (!Object.prototype.hasOwnProperty.call(types, key)) throw new Error("Unsupported Parameter key. Account settings and credentials belong in the script, not Parameter.");
      const value = overrides[key];
      if (typeof value !== types[key]) throw new Error("Wrong Parameter type for " + key);
      if (ranges[key] && (!Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1])) throw new Error("Parameter out of range: " + key);
      if (key === "decimalPlaces" && !Number.isInteger(value)) throw new Error("decimalPlaces must be 0, 1, or 2");
    }
    return config(Object.assign({}, base, overrides));
  }
  function utf8Base64(text) {
    const bytes = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes.charCodeAt(i), b = bytes.charCodeAt(i + 1), c = bytes.charCodeAt(i + 2);
      out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)]
        + (Number.isNaN(b) ? "=" : alphabet[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)])
        + (Number.isNaN(c) ? "=" : alphabet[c & 63]);
    }
    return out;
  }
  function tokenExpiration(token) {
    try {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const text = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      let bits = 0, count = 0, out = "";
      for (let i = 0; i < text.length && text[i] !== "="; i++) {
        const n = alphabet.indexOf(text[i]);
        if (n < 0) return 0;
        bits = (bits << 6) | n;
        count += 6;
        if (count >= 8) { count -= 8; out += String.fromCharCode((bits >> count) & 255); }
      }
      return (number(JSON.parse(out).exp) || 0) * 1000;
    } catch (_) { return 0; }
  }
  // Build-time IANA Africa/Casablanca transitions avoid relying on optional Intl
  // support, the phone's timezone, or a fixed UTC+1 assumption during Ramadan.
  function moroccoOffset(ms) {
    if (ms < MOROCCO_ZONE.start || ms >= MOROCCO_ZONE.end) return null;
    let offset = MOROCCO_ZONE.initial;
    for (const entry of MOROCCO_ZONE.transitions) {
      if (entry[0] > ms) break;
      offset = entry[1];
    }
    return offset;
  }
  function moroccoInstant(localMs) {
    let utc = localMs;
    for (let i = 0; i < 4; i++) {
      const offset = moroccoOffset(utc);
      if (offset == null) return null;
      const next = localMs - offset * 1000;
      if (next === utc) return utc;
      utc = next;
    }
    return utc;
  }
  function timestamp(value, morocco) {
    if (typeof value !== "string") return null;
    let text = value.trim().replace(" ", "T");
    if (!text) return null;
    if (!/(Z|[+-]\d\d:?\d\d)$/i.test(text)) {
      const ms = Date.parse(text + "Z");
      return Number.isFinite(ms) ? (morocco ? moroccoInstant(ms) : ms) : null;
    }
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
  }
  function monthCycle(ms) {
    const offset = moroccoOffset(ms);
    if (offset == null) return null;
    const d = new Date(ms + offset * 1000), y = d.getUTCFullYear(), m = d.getUTCMonth();
    const start = moroccoInstant(Date.UTC(y, m, 1)), end = moroccoInstant(Date.UTC(y, m + 1, 1));
    return start == null || end == null ? null : { start: start, end: end, estimated: true };
  }
  function pace(total, used, cycle, at) {
    if (!(total > 0) || used == null || !cycle || !(cycle.end > cycle.start)) return null;
    if (at < cycle.start || at >= cycle.end) return null;
    const fraction = clamp((at - cycle.start) / (cycle.end - cycle.start), 0, 1);
    if (fraction < 0.03) return null;
    const delta = clamp(used / total, 0, 1) - fraction;
    return { expected: total * fraction, fraction: fraction, difference: total * Math.abs(delta),
      status: Math.abs(delta) <= 0.02 ? "on pace" : delta > 0 ? "deficit" : "reserve" };
  }
  function orangeData(item) {
    const factors = { GO: 1, GB: 1, MO: 1 / 1024, MB: 1 / 1024 };
    for (const v of item.valueItems || []) {
      const unit = String(v.unit || "").toUpperCase(), n = number(typeof v.value === "string" ? v.value.replace(/[\s\u00a0\u202f]/g, "") : v.value);
      if (factors[unit] != null && n != null) return n * factors[unit];
    }
    // Some real Orange passes have no rawValue and an empty valueItems array:
    // their only amount is in message (also mirrored in messageParts).
    // These are alternative representations, not separate balances to sum.
    const texts = [item.rawValue, item.message, (item.messageParts || []).map(part => part.text || "").join(" ")];
    for (const text of texts) {
      const m = String(text || "").match(/(\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?)\s*(GO|GB|MO|MB)\b/i);
      if (m) return number(m[1].replace(/[\s\u00a0\u202f]/g, "")) * factors[m[2].toUpperCase()];
    }
    return null;
  }
  function itemText(item) {
    const text = item.rawValue || item.message || (item.valueItems || []).map(v => String(v.value) + " " + (v.unit || "")).join(" ");
    return String(text || "Unavailable").replace(/\bIllimit(?:e|é)s?\b/gi, "Unlimited").slice(0, 80);
  }
  function orange(balance, c, now) {
    if (!balance || !Array.isArray(balance.items)) throw new Error("Invalid Orange balance response");
    const plan = String(balance.tariffPlan || "Orange"), match = plan.match(/(\d+(?:[.,]\d+)?)\s*(GO|GB)\b/i);
    const internet = balance.items.find(item => orangeData(item) != null);
    const remaining = internet ? orangeData(internet) : null;
    const gaugeInitial = internet && internet.gauge && internet.gauge.initial;
    const gaugeTotal = gaugeInitial ? orangeData({ valueItems: [gaugeInitial] }) : null;
    const total = gaugeTotal > 0 ? gaugeTotal : match ? number(match[1]) : c.quotaGBOverride > 0 ? c.quotaGBOverride : null;
    const used = total > 0 && remaining != null ? Math.max(0, total - remaining) : null;
    const at = timestamp(balance.balanceAt, true);
    // Missing API observation time must not masquerade as a current balance.
    const cycle = at != null ? monthCycle(at) : null;
    let calls = null, sms = null;
    for (const item of balance.items) {
      if (item === internet) continue;
      const units = (item.valueItems || []).map(v => String(v.unit || "").toUpperCase());
      if (units.some(unit => ["H", "MIN", "S"].indexOf(unit) >= 0)) calls = itemText(item);
      else if (/sms/i.test(item.message || item.rawValue || "") || units.indexOf("SMS") >= 0) sms = itemText(item);
    }
    const topups = [];
    for (const group of balance.categories || []) {
      for (const item of group.items || []) {
        const gb = orangeData(item);
        if (gb != null && gb > 0) topups.push({ name: String(group.name || "Top-up").slice(0, 40), gb: gb });
      }
    }
    return { provider: "orange", orangeDataVersion: 2, plan: plan, total: total, used: used, remaining: remaining,
      observedAt: at, fetchedAt: now, cycle: cycle, pace: at != null ? pace(total, used, cycle, at) : null,
      calls: calls, sms: sms, topups: topups };
  }
  function winAmount(balance, field, unitField) {
    const n = number(balance[field]);
    if (n == null) return null;
    const unit = String(balance[unitField] || "").toUpperCase();
    if (["BYTE", "BYTES"].indexOf(unit) >= 0) return n / 1e9;
    if (["MEGABYTE", "MEGABYTES", "MB"].indexOf(unit) >= 0) return n / 1000;
    // Preserve the existing CLI's GB/default-unit behavior.
    return n;
  }
  function duration(n) {
    if (n == null) return null;
    n = Math.max(0, Math.floor(n));
    const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60);
    return h + " h" + (m ? " " + m + " min" : "");
  }
  function win(offer, c, now) {
    if (!offer || !Array.isArray(offer.assets)) throw new Error("Invalid win offer response");
    const assets = offer.assets, internet = assets.find(a => String(a.name || "").toLowerCase() === "internet");
    const b = internet ? internet.balance || {} : {};
    const total = winAmount(b, "defaultValue", "defaultUnitValue");
    let used = winAmount(b, "consumedValue", "consumedUnit");
    let remaining = winAmount(b, "restValue", "restUnit");
    if (used == null && total != null && remaining != null) used = Math.max(0, total - remaining);
    if (remaining == null && total != null && used != null) remaining = Math.max(0, total - used);
    // Balance assets can retain the previous cycle after renewal. The plan's
    // OFFER asset carries the actual billing cycle (as shown by win's app).
    const offerAsset = assets.find(a => a.type === "OFFER");
    const start = offerAsset ? timestamp(offerAsset.dateCycleStart, false) : null;
    const end = offerAsset ? timestamp(offerAsset.dateCycleEnd, false) : null;
    const cycle = start != null && end > start ? { start: start, end: end, estimated: false } : null;
    let calls = null, sms = null;
    for (const asset of assets) {
      const name = String(asset.name || "").toLowerCase(), balance = asset.balance || {};
      if (/sms/.test(name)) sms = balance.unlimited ? "Unlimited" : number(balance.restValue) != null ? number(balance.restValue) + " SMS" : null;
      if (/appel/.test(name)) {
        let seconds = number(balance.restValue);
        if (/^HOURS?$/.test(String(balance.restUnit || "").toUpperCase()) && seconds != null) seconds *= 3600;
        calls = balance.unlimited ? "Unlimited" : duration(seconds);
      }
    }
    return { provider: "win", winDataVersion: 2, plan: String(offerAsset && offerAsset.name || "win"), total: total,
      used: used, remaining: remaining, observedAt: now, fetchedAt: now, cycle: cycle,
      pace: pace(total, used, cycle, now), calls: calls, sms: sms };
  }
  function winPasses(groups) {
    if (!Array.isArray(groups)) throw new Error("Invalid win top-ups response");
    const out = [];
    for (const group of groups) for (const b of group.balances || []) {
      const gb = winAmount(b, "restValue", "restUnit");
      if (gb != null && gb > 0) out.push({ name: String(group.name || b.labelBalanceFr || "Top-up").slice(0, 40), gb: gb });
    }
    return out;
  }
  function fault(code, status) { const e = new Error(code); e.code = code; e.status = status || 0; return e; }
  function summary(error) {
    return ["auth", "selection", "budget", "network", "response", "storage"].indexOf(error.code) >= 0 ? error.code : "response";
  }
  function storage(host, provider) {
    const key = "telecom-" + provider + "-v1";
    if (!host.storage || typeof host.storage.getString !== "function" || typeof host.storage.setString !== "function") throw fault("storage");
    let state;
    try { state = JSON.parse(host.storage.getString(key) || "{}"); }
    catch (_) { throw fault("storage"); }
    if (!state || typeof state !== "object" || Array.isArray(state)) throw fault("storage");
    function save() {
      try {
        const text = JSON.stringify(state);
        if (host.storage.setString(key, text) === false || host.storage.getString(key) !== text) throw fault("storage");
      } catch (_) { throw fault("storage"); }
    }
    return { state: state, save: save };
  }
  function client(host, c, started) {
    async function request(provider, path, body, headers) {
      const remaining = c.networkBudgetMs - (host.now() - started) - 150;
      if (remaining < 1050) throw fault("budget");
      const timeout = Math.floor(remaining / 100) / 10;
      const options = { headers: Object.assign({ Accept: "application/json", "Content-Type": "application/json" }, headers || {}), timeoutInterval: timeout };
      if (body != null) options.body = body;
      const url = (provider === "orange" ? "https://maxit.orange.ma" : "https://api.win.ma/api") + path;
      const method = body == null ? "get" : "post";
      let response;
      try {
        // getResponse permits bounded, status-aware GET on runtime 1.0 when
        // present. POST has no metadata equivalent, so validate its shape.
        response = method === "get" && typeof host.http.getResponse === "function"
          ? await host.http.getResponse(url, options) : await host.http[method](url, options);
      } catch (_) { throw fault("network"); }
      let text = response;
      if (response && typeof response === "object" && typeof response.status === "number") {
        if (response.status === 401 || response.status === 403) throw fault("auth", response.status);
        if (response.status < 200 || response.status >= 300) throw fault("response", response.status);
        text = response.body;
      }
      let data;
      try { data = typeof text === "string" ? JSON.parse(text) : text; }
      catch (_) { throw fault("response"); }
      if (data == null || typeof data !== "object") throw fault("response");
      // The legacy $http bridge returns the body even for error HTTP status.
      const code = Number(data.statusCode || data.status || data.code);
      if (code === 401 || code === 403) throw fault("auth", code);
      return data;
    }
    return request;
  }
  function result(state, note) {
    return { snapshot: state.snapshot || null, passes: state.passes || null, failure: state.failure || null, note: note || "" };
  }
  function exhausted(snapshot) {
    return !!snapshot && snapshot.remaining != null && snapshot.remaining <= 1e-9;
  }
  function needsTopups(c, snapshot, family) {
    return c.dataSource === "topups" || c.dataSource === "auto" && exhausted(snapshot)
      || c.showTopups && family !== "small";
  }
  async function refresh(provider, input, setup, host, family) {
    const c = config(input), started = host.now(), store = storage(host, provider), s = store.state;
    const save = store.save;
    const action = setup.action || "normal";
    if (["normal", "refresh", "logout"].indexOf(action) < 0) throw new Error("Invalid setup action");
    if (action === "logout") {
      for (const key of Object.keys(s)) delete s[key];
      save();
      return result(s, "Logged out. Clear SETUP credentials and restore action to normal.");
    }
    if (setup.email || setup.password) {
      if (!setup.email || !setup.password) return result(s, "Enter both SETUP email and password.");
      if (!s.credentials || s.credentials.email !== setup.email || s.credentials.password !== setup.password) {
        for (const key of Object.keys(s)) delete s[key];
        s.credentials = { email: setup.email, password: setup.password };
        save();
      }
    }
    const identity = c.selection + ":" + (provider === "orange" ? c.quotaGBOverride : "");
    if (s.identity !== identity) {
      s.identity = identity; delete s.snapshot; delete s.passes; delete s.subscription; delete s.failure;
      // An Orange session belongs to the API's returned line, never to an
      // arbitrary user-supplied MSISDN. Login will validate selection again.
      if (provider === "orange") delete s.auth;
      save();
    }
    const topups = needsTopups(c, s.snapshot, family);
    // Refetch snapshots normalized by old parsers without discarding auth:
    // Orange's message-only passes and win's balance-asset cycle were wrong.
    const currentParser = s.snapshot && (provider === "orange" ? s.snapshot.orangeDataVersion === 2 : s.snapshot.winDataVersion === 2);
    const fresh = currentParser
      && started >= s.snapshot.fetchedAt && started - s.snapshot.fetchedAt < c.minimumFetchIntervalMinutes * 60000;
    const passesFresh = !topups || provider === "orange" || s.passes && !s.passes.error && s.passes.items != null
      && started - s.passes.fetchedAt < c.minimumFetchIntervalMinutes * 60000;
    if (action !== "refresh" && !s.failure && !s.pending && fresh && passesFresh) return result(s);
    if (!s.credentials) return result(s, "Setup: enter your email and password in SETUP, then run Preview.");
    const request = client(host, c, started);
    try {
      if (provider === "orange") {
        const headers = { "User-Agent": "Maxit/10.9.0", "X-OS": "android", "X-OS-Version": "Android 12", "X-OS-Model": "SM-A115F", "X-firebase-Id": "", "X-Line-Type": "PO" };
        if (!s.auth || !s.auth.token) {
          const user = await request(provider, "/moncompte/v10.9/login", { login: s.credentials.email,
            password: utf8Base64(s.credentials.password), culture: "fr", remember_me: true, channel: 2, checkByEmail: true }, headers);
          if (!user.token || !user.msisdn) throw fault("auth");
          if (c.selection && c.selection !== String(user.msisdn)) throw fault("selection");
          s.auth = { token: user.token, msisdn: user.msisdn, language: user.language || "fr" };
          s.pending = true; delete s.failure;
          save();
          return result(s, "Signed in. Run Preview again to fetch balances.");
        }
        const balance = await request(provider, "/fiche-client/v10.9/balances/" + encodeURIComponent(s.auth.msisdn), null,
          Object.assign({}, headers, { "X-SSO-TOKEN": s.auth.token, "Accept-Language": s.auth.language }));
        s.snapshot = orange(balance, c, host.now());
        s.passes = { items: s.snapshot.topups, at: s.snapshot.observedAt, fetchedAt: s.snapshot.fetchedAt, error: null };
      } else {
        const headers = { Referer: "https://win.ma/", "User-Agent": "Mozilla/5.0" };
        const auth = s.auth || {};
        if (!auth.accessToken || tokenExpiration(auth.accessToken) <= started + 30000) {
          if (auth.refreshToken && !auth.refreshFailed) {
            let tokens;
            try {
              tokens = await request(provider, "/v2/auth/refresh-token", { token: auth.refreshToken }, headers);
              if (!tokens.accessToken) throw fault("auth");
            } catch (error) {
              // Do not turn a transient network timeout into a password-login
              // storm. Rejected/invalid refresh responses fall back next run.
              if (error.code !== "network" && error.code !== "budget") { auth.refreshFailed = true; s.auth = auth; save(); }
              throw error;
            }
            s.auth = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || auth.refreshToken };
          } else {
            const login = await request(provider, "/v1/auth/login", { email: s.credentials.email, password: s.credentials.password }, headers);
            if (!login.tokens || !login.tokens.accessToken) throw fault("auth");
            s.auth = { accessToken: login.tokens.accessToken, refreshToken: login.tokens.refreshToken || "" };
          }
          s.pending = true; delete s.failure; save();
          return result(s, "Session ready. Run Preview again to continue.");
        }
        const authorized = Object.assign({}, headers, { Authorization: "Bearer " + auth.accessToken });
        if (!s.subscription) {
          const subscriptions = await request(provider, "/v1/subscriptions", null, authorized);
          if (!Array.isArray(subscriptions)) throw fault("response");
          const chosen = c.selection ? subscriptions.find(x => String(x.id) === c.selection)
            : subscriptions.find(x => x.status === "ACTIVE") || subscriptions[0];
          if (!chosen || !chosen.id) throw fault("selection");
          s.subscription = String(chosen.id); s.pending = true; delete s.failure; save();
          return result(s, "Line selected. Run Preview again to fetch your plan.");
        }
        const path = "/v1/subscriptions/" + encodeURIComponent(s.subscription) + "/offer-detail";
        // Start both before awaiting either. Do not assume Promise.all exists
        // on ScriptWidget's custom Promise bridge.
        async function attempt(operation) {
          try { return { value: await operation() }; } catch (error) { return { error: error }; }
        }
        // A recent plan can be reused when only its missing/deferred passes
        // need fetching. In particular this makes follow-up small-widget runs
        // useful without paying for the slow offer endpoint a second time.
        const onlyPasses = fresh && action !== "refresh" && !s.failure && !s.pending;
        const offerJob = onlyPasses ? null : attempt(() => request(provider, path, null, authorized));
        const getPasses = () => request(provider, "/v2/subscriptions/" + encodeURIComponent(s.subscription) + "/offer-detail/pass", null, authorized);
        let passesJob = topups ? attempt(getPasses) : null;
        const offerResult = offerJob ? await offerJob : null;
        if (offerResult && !offerResult.error) {
          try { s.snapshot = win(offerResult.value, c, host.now()); }
          catch (error) { offerResult.error = error; }
        }
        // Exhaustion may have been discovered by this very request. Attempt
        // passes only if the remaining budget permits; otherwise keep the plan
        // snapshot and retry passes alone on a later execution.
        if (!passesJob && offerResult && !offerResult.error && needsTopups(c, s.snapshot, family)) {
          passesJob = attempt(getPasses);
        }
        if (passesJob) {
          const passesResult = await passesJob;
          try {
            if (passesResult.error) throw passesResult.error;
            const at = host.now();
            s.passes = { items: winPasses(passesResult.value), at: at, fetchedAt: at, error: null };
          } catch (error) {
            if (error.status === 401 && s.auth) delete s.auth.accessToken;
            s.passes = Object.assign({ items: null, at: null }, s.passes || {}, { error: "Top-ups refresh failed" });
          }
        }
        if (offerResult && offerResult.error) {
          if (offerResult.error.status === 404) delete s.subscription;
          throw offerResult.error;
        }
      }
      delete s.failure; delete s.pending; save();
      return result(s);
    } catch (error) {
      const kind = summary(error);
      if (kind === "auth") {
        if (provider === "orange") delete s.auth;
        else if (s.auth) delete s.auth.accessToken;
      }
      s.failure = { kind: kind, at: host.now() }; save();
      return result(s);
    }
  }
  function age(at, now) {
    if (at == null) return "age unknown";
    const minutes = Math.max(0, Math.floor((now - at) / 60000));
    return minutes < 1 ? "just now" : minutes < 60 ? minutes + "m ago" : minutes < 1440 ? Math.floor(minutes / 60) + "h ago" : Math.floor(minutes / 1440) + "d ago";
  }
  function day(ms, morocco) {
    if (ms == null) return "Unavailable";
    const offset = morocco ? moroccoOffset(ms) : 0;
    if (offset == null) return "Unavailable";
    const d = new Date(ms + offset * 1000);
    return d.getUTCDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  }
  function view(provider, input, data, now) {
    const c = config(input), s = data.snapshot;
    const fmt = n => n == null ? "—" : n.toFixed(c.decimalPlaces);
    const unavailable = "Unavailable";
    const v = { label: c.label || (provider === "orange" ? "Orange" : "win"), c: c,
      accent: c.accentColor || (provider === "orange" ? "#ff943d" : "#b793f7"), note: data.note || "",
      hasData: !!s, age: "not updated", stale: false, error: "", notice: "", value: "—", unit: "GB", sub: "Data unavailable",
      percent: null, pace: null, renewal: unavailable, cycle: unavailable, calls: unavailable, sms: unavailable,
      topups: "Top-ups unavailable", topupsAge: "age unknown", topupsStale: true, plan: "Subscription",
      activeSource: "plan", topupItems: [], planContext: "Plan unavailable", planAge: "age unknown" };
    const errors = { auth: "Sign-in rejected. Check SETUP credentials; run Preview again.", selection: "Selected line is unavailable. Check CONFIG.selection.",
      budget: "Refresh deferred: time budget.", network: "Could not reach provider.", response: "Provider returned an unexpected response.", storage: "Cannot save widget state." };
    v.error = data.failure ? errors[data.failure.kind] || "Refresh failed." : "";
    if (!s && c.dataSource !== "topups") return v;
    function headline(amount) {
      if (amount == null) return;
      const base = provider === "orange" ? 1024 : 1000;
      const mb = amount * base, kb = mb * base;
      if (amount >= 1) { v.value = fmt(amount); v.unit = "GB"; }
      else if (amount === 0) { v.value = "0"; v.unit = "MB"; }
      else {
        const n = mb >= 1 ? mb : kb >= 1 ? kb : kb * base;
        v.unit = mb >= 1 ? "MB" : kb >= 1 ? "KB" : "B";
        v.value = n.toFixed(v.unit === "B" ? 0 : c.decimalPlaces).replace(/\.0+$/, "");
      }
    }
    if (s) {
      const at = s.observedAt;
      // Balance freshness and cycle validity are separate. A newly fetched
      // balance can have obsolete billing metadata; do not call its age stale.
      v.stale = !!data.failure || at == null || now - at > c.staleAfterMinutes * 60000;
      const cycleWarning = s.cycle && now >= s.cycle.end ? "Cycle dates outdated"
        : s.cycle && now < s.cycle.start ? "Cycle not started" : "";
      v.notice = data.failure ? "Refresh failed · cached" : at == null ? "Balance age unknown"
        : v.stale ? "Balance is old" : cycleWarning;
      v.age = age(at, now);
      headline(c.headline === "remaining" ? s.remaining : s.used);
      v.sub = (c.headline === "remaining" ? "remaining" : "used") + (s.total > 0 ? " of " + fmt(s.total) + " GB" : " · quota unknown");
      v.percent = s.total > 0 && s.used != null ? clamp(s.used / s.total, 0, 1) : null;
      v.used = fmt(s.used) + " GB used"; v.remaining = fmt(s.remaining) + " GB left";
      v.plan = s.plan;
      if (s.cycle) {
        v.renewal = cycleWarning || day(s.cycle.end, provider === "orange") + (s.cycle.estimated ? " · est." : "");
        v.cycle = day(s.cycle.start, provider === "orange") + " – " + day(s.cycle.end, provider === "orange") + (s.cycle.estimated ? " · est." : "");
      }
      if (c.showPace && s.pace && !cycleWarning) v.pace = {
        text: s.pace.status === "on pace" ? "On pace" : fmt(s.pace.difference) + " GB " + s.pace.status,
        fraction: s.pace.fraction, bad: s.pace.status === "deficit",
        expected: fmt(s.pace.expected) + " GB expected · " + Math.round(s.pace.fraction * 100) + "% of cycle",
      };
      v.calls = s.calls || unavailable; v.sms = s.sms || unavailable;
      v.planAge = v.age;
      v.planContext = exhausted(s) ? "Plan exhausted" : v.remaining + " · plan";
      if (v.stale) v.planContext += " · last known";
    }
    const planStale = v.stale;
    if (data.passes) {
      const p = data.passes;
      v.topups = p.items == null ? "Top-ups unavailable" : p.items.length ? fmt(p.items.reduce((sum, item) => sum + item.gb, 0)) + " GB separate" : "No data top-ups";
      v.topupsStale = !!p.error || p.at == null || now - p.at > c.staleAfterMinutes * 60000;
      v.topupsAge = age(p.at, now);
      v.topupItems = p.items || [];
    }
    if (c.dataSource === "topups" || c.dataSource === "auto" && exhausted(s)) {
      const p = data.passes;
      v.activeSource = "topups";
      v.hasData = !!s || !!(p && Array.isArray(p.items));
      v.value = "—"; v.unit = "GB";
      const amount = p && Array.isArray(p.items) ? p.items.reduce((sum, item) => sum + item.gb, 0) : null;
      headline(amount);
      v.sub = amount == null ? "Top-ups unavailable" : amount === 0 ? "No data top-ups left" : "remaining";
      v.age = v.topupsAge;
      v.stale = v.topupsStale || c.dataSource === "auto" && planStale;
      v.notice = amount == null ? "Top-ups unavailable" : p.error ? "Top-up refresh failed"
        : v.topupsStale ? "Top-up balance is old" : c.dataSource === "auto" && planStale ? "Plan check needed" : "";
      v.percent = null; v.pace = null;
    }
    return v;
  }
  return { config: config, instanceConfig: instanceConfig, number: number, utf8Base64: utf8Base64, tokenExpiration: tokenExpiration,
    timestamp: timestamp, monthCycle: monthCycle, pace: pace, orange: orange, win: win, winPasses: winPasses,
    refresh: refresh, view: view };
})();
