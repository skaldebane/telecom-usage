import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const buildPath = fileURLToPath(new URL('./build.py', import.meta.url));
const zone = JSON.parse(execFileSync('python3', ['-c', 'import runpy,json,sys; print(json.dumps(runpy.run_path(sys.argv[1])["morocco_zone"]()))', buildPath], { encoding: 'utf8' }));
const context = vm.createContext({ MOROCCO_ZONE: zone });
vm.runInContext(readFileSync(new URL('./core.js', import.meta.url), 'utf8') + '\nglobalThis.api = Telecom;', context);
const T = context.api;
const now = Date.parse('2026-10-21T00:00:00Z');
const jwt = exp => 'header.' + Buffer.from(JSON.stringify({ exp: exp / 1000 })).toString('base64url') + '.sig';
const tokens = () => ({ accessToken: jwt(now + 3600000), refreshToken: 'synthetic-refresh' });
const orangeBalance = () => ({ tariffPlan: 'YOXO 60GO', balanceAt: '2026-10-21T01:00:00+01:00', items: [
  { rawValue: '27,6 GO', valueItems: [{ value: '27,6', unit: 'GO' }] },
  { rawValue: '2 h 15 min', valueItems: [{ value: 2.25, unit: 'H' }] },
  { message: '120 SMS' },
], categories: [{ name: 'Internet top-up', items: [{ rawValue: '2048 MO' }] }] });
const offer = () => ({ assets: [
  { type: 'OFFER', name: 'win 50 GO' },
  { name: 'Internet', dateCycleStart: '2026-10-01T00:00:00Z', dateCycleEnd: '2026-11-01T00:00:00Z', balance: {
    defaultValue: 50, defaultUnitValue: 'GIGABYTES', consumedValue: 42000, consumedUnit: 'MEGABYTES', restValue: 8000000000, restUnit: 'BYTES',
  } },
  { name: 'Appels', balance: { restValue: 6000, restUnit: 'SECONDS' } },
  { name: 'SMS', balance: { unlimited: true } },
] });
const passes = () => [{ name: 'Pass Internet', balances: [{ restValue: 5000, restUnit: 'MEGABYTES' }] }];
const plain = x => JSON.parse(JSON.stringify(x));

function harness(provider = 'win', options = {}) {
  const map = options.map || new Map(), calls = [];
  let clock = now;
  const host = {
    now: () => clock,
    storage: {
      getString: k => map.get(k) || '',
      setString: (k, value) => { map.set(k, value); return true; },
    },
    http: {},
  };
  async function request(url, params, method) {
    calls.push({ url, params, method });
    if (options.handler) return await options.handler(url, params, method, () => clock, ms => { clock += ms; });
    let value;
    if (url.endsWith('/login')) value = provider === 'win' ? { tokens: tokens() } : { token: 'synthetic-token', msisdn: 'synthetic-line', language: 'fr' };
    else if (url.endsWith('/refresh-token')) value = tokens();
    else if (url.endsWith('/subscriptions')) value = [{ id: 'synthetic-subscription', status: 'ACTIVE' }];
    else if (url.endsWith('/pass')) value = passes();
    else if (url.endsWith('/offer-detail')) value = offer();
    else value = orangeBalance();
    return method === 'get' ? { status: 200, body: JSON.stringify(value) } : JSON.stringify(value);
  }
  host.http.getResponse = (url, params) => request(url, params, 'get');
  host.http.post = (url, params) => request(url, params, 'post');
  const key = 'telecom-' + provider + '-v1';
  const read = () => JSON.parse(map.get(key) || '{}');
  const write = state => map.set(key, JSON.stringify(state));
  const run = (config = {}, setup = {}, family = 'medium') => T.refresh(provider, config, setup, host, family);
  async function ready(config = {}) {
    await run(config, { email: 'fixture@example.invalid', password: 'fake-only' });
    if (provider === 'win') await run(config);
    return await run(config);
  }
  return { map, calls, host, read, write, run, ready, advance: ms => { clock += ms; } };
}

test('Unicode password base64 matches UTF-8, without btoa', () => {
  for (const text of ['', 'a', 'ab', 'abc', 'päss🔐مرحبا', 'line\nbreak']) {
    assert.equal(T.utf8Base64(text), Buffer.from(text).toString('base64'));
  }
});
test('JWT expiry works without atob; malformed tokens expire immediately', () => {
  assert.equal(T.tokenExpiration(jwt(now)), now);
  assert.equal(T.tokenExpiration('bad-token'), 0);
});
test('configuration validates appearance and safely bounds budgets', () => {
  assert.equal(T.config({ networkBudgetMs: 10000 }).networkBudgetMs, 3500);
  assert.equal(T.config({ networkBudgetMs: 100 }).networkBudgetMs, 2000);
  assert.throws(() => T.config({ accentColor: 'red' }), /Accent/);
  assert.throws(() => T.config({ headline: 'wat' }), /headline/);
  assert.equal(T.config({ decimalPlaces: 9 }).decimalPlaces, 2);
});
test('blank parameters use defaults; instance JSON overrides without mutating base', () => {
  const base = { headline: 'used', showTopups: false, appearance: 'auto', selection: 'shared-line' };
  assert.equal(T.instanceConfig(base, '  ').headline, 'used');
  assert.equal(T.instanceConfig(base, undefined).headline, 'used');
  const changed = T.instanceConfig(base, '{"headline":"remaining","showTopups":true,"appearance":"light","decimalPlaces":2}');
  assert.equal(changed.headline, 'remaining'); assert.equal(changed.showTopups, true);
  assert.equal(changed.selection, 'shared-line'); assert.equal(changed.decimalPlaces, 2);
  assert.equal(base.headline, 'used'); assert.equal(base.showTopups, false);
  assert.equal(T.instanceConfig(base, '{}').appearance, 'auto');
});
test('parameters reject malformed JSON, non-objects, wrong types and out-of-range values', () => {
  for (const raw of ['not-json', '[]', 'null', 'false', '42', '"text"', '{"showTopups":"false"}',
    '{"decimalPlaces":1.5}', '{"networkBudgetMs":5000}', '{"staleAfterMinutes":0}',
    '{"label":null}', '{"headline":"other"}', '{"appearance":"pink"}', '{"accentColor":"red"}', ' '.repeat(4097) + '{}']) {
    assert.throws(() => T.instanceConfig({}, raw), /Parameter|parameter|headline|appearance|Accent|decimalPlaces/);
  }
});
test('parameters forbid account identity, credentials, actions and prototype keys without echoing input', () => {
  for (const raw of ['{"selection":"other"}', '{"quotaGBOverride":99}', '{"password":"SECRET"}',
    '{"email":"SECRET"}', '{"action":"logout"}', '{"__proto__":{"polluted":true}}', '{"constructor":"SECRET"}']) {
    assert.throws(() => T.instanceConfig({}, raw), error => {
      assert.equal(error.message.includes('SECRET'), false); return /Unsupported Parameter key/.test(error.message);
    });
  }
  assert.equal({}.polluted, undefined);
});
test('instances render different headlines while sharing data without persisting overrides', async () => {
  const h = harness(); const ready = await h.ready();
  const before = JSON.stringify(h.read());
  const first = T.instanceConfig({}, '{"headline":"remaining","label":"INSTANCE ONLY","appearance":"light"}');
  const second = T.instanceConfig({}, '{"headline":"used","showPace":false}');
  const r1 = await h.run(first); const r2 = await h.run(second);
  const v1 = T.view('win', first, r1, now), v2 = T.view('win', second, r2, now);
  assert.equal(v1.value, '8.0'); assert.equal(v2.value, '42.0'); assert.equal(v2.pace, null);
  assert.equal(v1.label, 'INSTANCE ONLY'); assert.equal(v2.label, 'win');
  assert.equal(JSON.stringify(h.read()), before);
  assert.equal(h.calls.length, 3); assert.equal(r1.snapshot.observedAt, ready.snapshot.observedAt);
});
test('Orange normalizes separate plan/top-ups, comma numbers and binary MB', () => {
  const value = T.orange(orangeBalance(), T.config({}), now);
  assert.equal(value.remaining, 27.6);
  assert.equal(value.used, 32.4);
  assert.equal(value.total, 60);
  assert.equal(value.topups[0].gb, 2);
  assert.equal(value.calls, '2 h 15 min');
  assert.equal(value.sms, '120 SMS');
  assert.equal(value.pace.status, 'reserve');
  assert.equal(value.cycle.estimated, true);
});
test('Orange real pass shape: 802 MO in message only displays 802 MB, not zero', () => {
  const b = orangeBalance();
  b.items[0].valueItems[0].value = 0;
  b.categories = [{ name: 'Pass Internet', items: [{
    message: 'Il vous reste 802 MO sur ce pass', valueItems: [],
    messageParts: [{ text: '802 MO', type: 'highlighted' }, { text: 'restants', type: 'normal' }],
  }] }];
  const snapshot = T.orange(b, T.config({}), now);
  assert.equal(snapshot.topups.length, 1);
  assert.equal(snapshot.topups[0].gb, 802 / 1024);
  const v = T.view('orange', {}, { snapshot, passes: { items: snapshot.topups, at: now } }, now);
  assert.equal(v.activeSource, 'topups'); assert.equal(v.value, '802'); assert.equal(v.unit, 'MB');
});
test('Orange messageParts fallback handles split/grouped numbers without duplicate counting', () => {
  const b = orangeBalance();
  b.categories = [{ name: 'Data', items: [{ valueItems: [], messageParts: [{ text: '1\u202f024' }, { text: 'MO restants' }] }] }];
  assert.equal(T.orange(b, T.config({}), now).topups[0].gb, 1);
  b.categories[0].items[0] = { rawValue: '512 MO', message: 'Il vous reste 512 MO', valueItems: [{ unit: 'MO', value: '512' }] };
  const value = T.orange(b, T.config({}), now);
  assert.equal(value.topups.length, 1); assert.equal(value.topups[0].gb, 0.5);
});
test('Orange refreshes old parser snapshots without logging in again', async () => {
  const h = harness('orange'); await h.ready();
  const state = h.read(); delete state.snapshot.orangeDataVersion;
  state.snapshot.topups = []; state.passes.items = []; h.write(state);
  const count = h.calls.length;
  await h.run();
  assert.equal(h.calls.length, count + 1); assert.match(h.calls.at(-1).url, /\/balances\//);
  assert.equal(h.read().snapshot.orangeDataVersion, 2);
});
test('Orange quota override only fills missing quota; known gauge wins', () => {
  const b = orangeBalance();
  assert.equal(T.orange(b, T.config({ quotaGBOverride: 99 }), now).total, 60);
  b.tariffPlan = 'Custom plan';
  assert.equal(T.orange(b, T.config({ quotaGBOverride: 99 }), now).total, 99);
  assert.equal(T.orange(b, T.config({}), now).used, null);
  b.items[0].gauge = { initial: { value: 70, unit: 'GO' } };
  assert.equal(T.orange(b, T.config({ quotaGBOverride: 99 }), now).total, 70);
});
test('Orange missing timestamps are unknown/stale; no false current pace', () => {
  const b = orangeBalance(); delete b.balanceAt;
  const snapshot = T.orange(b, T.config({}), now);
  const view = T.view('orange', {}, { snapshot }, now);
  assert.equal(snapshot.observedAt, null);
  assert.equal(snapshot.pace, null);
  assert.equal(view.stale, true);
  assert.equal(view.age, 'age unknown');
});
test('Casablanca cycle boundaries match zoneinfo through Ramadan transition', () => {
  const dates = ['2026-02-20T12:00:00Z', '2026-03-20T12:00:00Z', '2026-10-31T23:30:00Z', '2026-12-31T23:30:00Z'];
  for (const iso of dates) {
    const expected = JSON.parse(execFileSync('python3', ['-c',
      'import sys,json; from datetime import datetime; from zoneinfo import ZoneInfo; d=datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")).astimezone(ZoneInfo("Africa/Casablanca")); a=d.replace(day=1,hour=0,minute=0,second=0,microsecond=0); b=a.replace(year=a.year+1,month=1) if a.month==12 else a.replace(month=a.month+1); print(json.dumps([int(a.timestamp()*1000),int(b.timestamp()*1000)]))', iso], { encoding: 'utf8' }));
    const cycle = T.monthCycle(Date.parse(iso));
    assert.deepEqual([cycle.start, cycle.end], expected);
  }
  assert.equal(T.monthCycle(Date.parse('2050-01-01Z')), null);
});
test('naive Orange time uses Morocco, naive win time uses UTC', () => {
  // January is UTC+1 in the build machine's IANA 2026e dataset. Do not
  // assume Morocco is UTC+1 for every month or future political rule.
  assert.equal(T.timestamp('2026-01-21T01:00:00', true), Date.parse('2026-01-21T00:00:00Z'));
  assert.equal(T.timestamp('2026-10-21T00:00:00', false), now);
});
test('pace warm-up, tolerance, reserve and deficit mirror CLI rules', () => {
  const cycle = { start: 0, end: 100000 };
  assert.equal(T.pace(100, 0, cycle, 2999), null);
  assert.equal(T.pace(100, 50, cycle, 50000).status, 'on pace');
  assert.equal(T.pace(100, 30, cycle, 50000).status, 'reserve');
  assert.equal(T.pace(100, 70, cycle, 50000).status, 'deficit');
  assert.equal(T.pace(null, null, cycle, 50000), null);
});
test('win decimal data conversion, cycle, calls and unlimited SMS', () => {
  const s = T.win(offer(), T.config({}), now);
  assert.equal(s.total, 50); assert.equal(s.used, 42); assert.equal(s.remaining, 8);
  assert.equal(s.calls, '1 h 40 min'); assert.equal(s.sms, 'Unlimited');
  assert.equal(s.pace.status, 'deficit'); assert.equal(s.cycle.estimated, false);
  assert.equal(T.winPasses(passes())[0].gb, 5);
});
test('missing win values are not turned into zero; missing usage can be derived', () => {
  const a = offer(); delete a.assets[1].balance.consumedValue;
  assert.equal(T.win(a, {}, now).used, 42);
  delete a.assets[1].balance.restValue;
  assert.equal(T.win(a, {}, now).used, null);
  const v = T.view('win', {}, { snapshot: T.win({ assets: [] }, {}, now) }, now);
  assert.equal(v.value, '—'); assert.equal(v.percent, null); assert.equal(v.calls, 'Unavailable');
});
test('empty setup makes no request and never invents a snapshot', async () => {
  const h = harness();
  const r = await h.run();
  assert.equal(r.snapshot, null); assert.match(r.note, /Setup/); assert.equal(h.calls.length, 0);
});
test('Orange setup is two executions and reused session skips login', async () => {
  const h = harness('orange');
  await h.ready();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].params.body.password, Buffer.from('fake-only').toString('base64'));
  await h.run({}, { action: 'refresh' });
  assert.equal(h.calls.length, 3);
  assert.match(h.calls[2].url, /balances/);
  assert.equal(h.read().credentials.email, 'fixture@example.invalid');
});
test('win setup stages login, subscription discovery, then one offer', async () => {
  const h = harness(); const r = await h.ready();
  assert.equal(h.calls.length, 3); assert.ok(r.snapshot);
  assert.match(h.calls[0].url, /login$/); assert.match(h.calls[1].url, /subscriptions$/);
  assert.match(h.calls[2].url, /offer-detail$/);
  assert.equal(h.calls[2].params.headers.Authorization, 'Bearer ' + tokens().accessToken);
});
test('warm cache avoids duplicate requests; force refresh bypasses it', async () => {
  const h = harness(); await h.ready();
  await h.run(); assert.equal(h.calls.length, 3);
  await h.run({}, { action: 'refresh' }); assert.equal(h.calls.length, 4);
});
test('different credentials clear account cache and line', async () => {
  const h = harness(); await h.ready();
  const r = await h.run({}, { email: 'other@example.invalid', password: 'other-fake' });
  assert.equal(r.snapshot, null); assert.equal(h.read().subscription, undefined);
});
test('explicit missing selection fails, never switches to another subscription', async () => {
  const h = harness(); await h.run({ selection: 'missing' }, { email: 'x', password: 'y' });
  const r = await h.run({ selection: 'missing' });
  assert.equal(r.failure.kind, 'selection'); assert.equal(h.read().subscription, undefined);
});
test('Orange rejects an explicit line not returned by login', async () => {
  const h = harness('orange');
  const r = await h.run({ selection: 'not-the-line' }, { email: 'x', password: 'y' });
  assert.equal(r.failure.kind, 'selection'); assert.equal(h.read().auth, undefined);
});
test('changing selection invalidates the previous snapshot', async () => {
  const h = harness(); await h.ready();
  const r = await h.run({ selection: 'missing' });
  assert.equal(r.snapshot, null); assert.equal(r.failure.kind, 'selection');
});
test('expired win token refreshes once, persists rotation and fetches next run', async () => {
  const h = harness(); await h.ready();
  const s = h.read(); s.auth.accessToken = jwt(now - 1000); h.write(s);
  await h.run({}, { action: 'refresh' });
  assert.match(h.calls.at(-1).url, /refresh-token$/);
  assert.equal(h.read().pending, true);
  await h.run(); assert.match(h.calls.at(-1).url, /offer-detail$/);
  assert.equal(h.read().pending, undefined);
});
test('rejected refresh defers password fallback until a later execution', async () => {
  const h = harness(); await h.ready();
  const s = h.read(); s.auth.accessToken = jwt(now - 1000); h.write(s);
  h.host.http.post = async () => JSON.stringify({ error: 'unauthorized' });
  const r = await h.run({}, { action: 'refresh' });
  assert.equal(r.failure.kind, 'auth'); assert.equal(h.read().auth.refreshFailed, true);
  let loginCalls = 0;
  h.host.http.post = async url => { assert.match(url, /login$/); loginCalls++; return JSON.stringify({ tokens: tokens() }); };
  await h.run(); assert.equal(loginCalls, 1);
});
test('transient refresh failure does not discard refresh token or force login', async () => {
  const h = harness(); await h.ready();
  const s = h.read(); s.auth.accessToken = jwt(now - 1000); h.write(s);
  h.host.http.post = async () => { throw new Error('raw private body must not escape'); };
  const r = await h.run({}, { action: 'refresh' });
  assert.equal(r.failure.kind, 'network'); assert.equal(h.read().auth.refreshFailed, undefined);
  assert.equal(JSON.stringify(r).includes('raw private'), false);
});
test('401 invalidates only access auth and retains last good cache', async () => {
  const h = harness(); await h.ready();
  h.host.http.getResponse = async () => ({ status: 401, body: '{}' });
  const r = await h.run({}, { action: 'refresh' });
  assert.equal(r.failure.kind, 'auth'); assert.ok(r.snapshot);
  assert.equal(h.read().auth.accessToken, undefined); assert.equal(h.read().auth.refreshToken, 'synthetic-refresh');
});
test('a removed win subscription is rediscovered next execution', async () => {
  const h = harness(); await h.ready();
  h.host.http.getResponse = async () => ({ status: 404, body: '{}' });
  const r = await h.run({}, { action: 'refresh' });
  assert.ok(r.snapshot); assert.equal(h.read().subscription, undefined);
});
test('network failure keeps data/observation timestamp and marks it stale immediately', async () => {
  const h = harness(); const good = await h.ready();
  h.host.http.getResponse = async () => { throw new Error('timeout'); };
  const r = await h.run({}, { action: 'refresh' });
  assert.equal(r.snapshot.observedAt, good.snapshot.observedAt);
  assert.equal(T.view('win', {}, r, now).stale, true);
});
test('independent top-ups requests start concurrently and keep their own timestamp', async () => {
  const h = harness(); await h.ready();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let offerStarted = false, passStarted = false;
  h.host.http.getResponse = async url => {
    if (url.endsWith('/pass')) { passStarted = true; release(); return { status: 200, body: JSON.stringify(passes()) }; }
    offerStarted = true; await waiting; return { status: 200, body: JSON.stringify(offer()) };
  };
  const r = await h.run({ showTopups: true }, { action: 'refresh' });
  assert.equal(offerStarted && passStarted, true); assert.equal(r.passes.items[0].gb, 5);
  assert.equal(r.passes.at, now);
});
test('small with an active plan skips optional secondary top-ups', async () => {
  const h = harness(); await h.ready();
  await h.run({ showTopups: true }, { action: 'refresh' }, 'small');
  assert.equal(h.calls.some(x => x.url.endsWith('/pass')), false);
});
test('failed passes retain independent cached balance while plan succeeds', async () => {
  const h = harness(); await h.ready({ showTopups: true });
  const old = h.read().passes.at;
  h.host.http.getResponse = async url => {
    if (url.endsWith('/pass')) throw new Error('timeout');
    return { status: 200, body: JSON.stringify(offer()) };
  };
  const r = await h.run({ showTopups: true }, { action: 'refresh' });
  assert.equal(r.failure, null); assert.equal(r.passes.at, old);
  assert.ok(r.passes.error); assert.equal(T.view('win', {}, r, now).topupsStale, true);
});
test('fresh passes survive a failed plan request', async () => {
  const h = harness(); await h.ready();
  h.host.http.getResponse = async url => url.endsWith('/pass')
    ? { status: 200, body: JSON.stringify(passes()) } : { status: 503, body: '{}' };
  const r = await h.run({ showTopups: true }, { action: 'refresh' });
  assert.equal(r.failure.kind, 'response'); assert.equal(r.passes.items[0].gb, 5);
});
test('budget never starts a request if too little time remains', async () => {
  const h = harness(); await h.ready();
  let calls = 0;
  h.host.now = () => { calls++; return now + (calls >= 2 ? 3000 : 0); };
  const n = h.calls.length;
  const r = await h.run({}, { action: 'refresh' });
  assert.equal(r.failure.kind, 'budget'); assert.equal(h.calls.length, n);
});
test('request timeout reserves rendering headroom and never exceeds budget', async () => {
  const h = harness(); await h.ready();
  for (const req of h.calls) {
    assert.ok(req.params.timeoutInterval <= 3.35);
    assert.ok(req.params.timeoutInterval >= 1);
  }
});
test('legacy GET without status metadata still works', async () => {
  const h = harness(); await h.ready();
  delete h.host.http.getResponse;
  h.host.http.get = async () => JSON.stringify(offer());
  const r = await h.run({}, { action: 'refresh' }); assert.equal(r.failure, null);
});
test('logout clears credentials, tokens and snapshots; no network call', async () => {
  const h = harness(); await h.ready(); const count = h.calls.length;
  const r = await h.run({}, { action: 'logout' });
  assert.equal(r.snapshot, null); assert.deepEqual(h.read(), {}); assert.equal(h.calls.length, count);
});
test('storage write failure and corrupt state fail visibly rather than silently', async () => {
  const h = harness(); h.host.storage.setString = () => false;
  await assert.rejects(h.run(), /storage/);
  const broken = harness('win', { map: new Map([['telecom-win-v1', 'broken']]) });
  await assert.rejects(broken.run(), /storage/);
});
test('provider storage namespaces stay separate', async () => {
  const map = new Map(); await harness('orange', { map }).ready(); await harness('win', { map }).ready();
  assert.equal(map.size, 2);
});
test('remaining headline never reverses consumed progress; pace snapshot is immutable', () => {
  const snapshot = T.win(offer(), {}, now);
  const data = { snapshot };
  const v = T.view('win', { headline: 'remaining' }, data, now + 3600000);
  assert.equal(v.value, '8.0'); assert.equal(v.percent, 0.84);
  assert.equal(v.pace.expected, T.view('win', {}, data, now).pace.expected);
});
test('auto switches an exhausted plan to top-ups, with no invented meter or pace', () => {
  const snapshot = T.win(offer(), {}, now); snapshot.used = 50; snapshot.remaining = 0;
  const v = T.view('win', {}, { snapshot, passes: { items: [{ name: 'Data pass', gb: 5 }], at: now } }, now);
  assert.equal(v.activeSource, 'topups'); assert.equal(v.value, '5.0');
  assert.match(v.sub, /remaining/); assert.equal(v.percent, null); assert.equal(v.pace, null);
  assert.equal(v.planContext, 'Plan exhausted'); assert.equal(v.age, 'just now');
});
test('auto stays with a nonempty plan, even when rounded display would be zero', () => {
  const snapshot = T.win(offer(), {}, now); snapshot.remaining = 0.001;
  const v = T.view('win', {}, { snapshot, passes: { items: [{ name: 'Pass', gb: 5 }], at: now } }, now);
  assert.equal(v.activeSource, 'plan');
});
test('dataSource is a per-instance override; explicit plan never auto-switches', () => {
  const snapshot = T.win(offer(), {}, now); snapshot.remaining = 0;
  const data = { snapshot, passes: { items: [{ name: 'Pass', gb: 5 }], at: now } };
  const planConfig = T.instanceConfig({}, '{"dataSource":"plan"}');
  assert.equal(T.view('win', planConfig, data, now).activeSource, 'plan');
  snapshot.remaining = 8;
  const topConfig = T.instanceConfig({}, '{"dataSource":"topups"}');
  assert.equal(T.view('win', topConfig, data, now).value, '5.0');
  assert.throws(() => T.instanceConfig({}, '{"dataSource":"combined"}'), /dataSource/);
});
test('unknown top-up balance is unavailable, not zero; a successful empty result is zero', () => {
  const snapshot = T.win(offer(), {}, now); snapshot.remaining = 0;
  const unknown = T.view('win', {}, { snapshot }, now);
  assert.equal(unknown.value, '—'); assert.match(unknown.sub, /unavailable/); assert.equal(unknown.stale, true);
  const empty = T.view('win', {}, { snapshot, passes: { items: [], at: now } }, now);
  assert.equal(empty.value, '0'); assert.equal(empty.unit, 'MB'); assert.equal(empty.stale, false);
});
test('a fresh win balance with an ended cycle is not called stale and has no pace', () => {
  const data = offer();
  data.assets[1].dateCycleStart = '2026-09-20T00:00:00Z';
  data.assets[1].dateCycleEnd = '2026-10-20T00:00:00Z';
  data.assets[1].balance.expireDate = '2026-11-20T00:00:00Z';
  const snapshot = T.win(data, {}, now);
  assert.equal(snapshot.pace, null);
  const v = T.view('win', {}, { snapshot }, now);
  assert.equal(v.age, 'just now'); assert.equal(v.stale, false);
  assert.equal(v.notice, 'Cycle dates outdated'); assert.equal(v.pace, null);
  assert.equal(v.renewal, 'Cycle dates outdated');
  assert.equal(snapshot.cycle.end, Date.parse('2026-10-20T00:00:00Z'), 'expiry must not invent a new billing cycle');
});
test('cached pace is suppressed after cycle end, not shown as a final reserve', () => {
  const snapshot = T.win(offer(), {}, now);
  snapshot.cycle = { start: now - 86400000, end: now - 1, estimated: false };
  const v = T.view('win', {}, { snapshot }, now);
  assert.equal(v.pace, null); assert.equal(v.notice, 'Cycle dates outdated');
  assert.equal(T.pace(20, 12.8, snapshot.cycle, now), null);
});
test('a future cycle has an explicit status and does not produce pace', () => {
  const snapshot = T.win(offer(), {}, now);
  snapshot.cycle = { start: now + 1000, end: now + 86400000, estimated: false };
  const v = T.view('win', {}, { snapshot }, now);
  assert.equal(v.notice, 'Cycle not started'); assert.equal(v.pace, null);
});
test('a failed refresh with a recent cache has a separate explanation', () => {
  const snapshot = T.win(offer(), {}, now);
  const v = T.view('win', {}, { snapshot, failure: { kind: 'network' } }, now);
  assert.equal(v.age, 'just now'); assert.equal(v.notice, 'Refresh failed · cached'); assert.equal(v.stale, true);
});
test('adaptive headline units do not round a positive balance down to zero', () => {
  const snapshot = T.win(offer(), {}, now);
  for (const [gb, value, unit] of [[0.8, '800', 'MB'], [0.002, '2', 'MB'], [0.000002, '2', 'KB'], [0.000000002, '2', 'B'], [0, '0', 'MB']]) {
    snapshot.remaining = gb;
    const v = T.view('win', { headline: 'remaining', dataSource: 'plan', decimalPlaces: 0 }, { snapshot }, now);
    assert.equal(v.value, value); assert.equal(v.unit, unit);
  }
});
test('top-up aggregate has independent freshness and does not inflate plan quota', () => {
  const snapshot = T.win(offer(), {}, now); snapshot.remaining = 0;
  const v = T.view('win', {}, { snapshot, passes: { items: [{ name: 'A', gb: 2 }, { name: 'B', gb: 3 }], at: now - 7200000 } }, now);
  assert.equal(v.value, '5.0'); assert.equal(v.age, '2h ago'); assert.equal(v.stale, true);
  assert.equal(v.topupItems.length, 2); assert.equal(snapshot.total, 50);
});
test('forced top-ups can render even if the plan request failed with no plan cache', () => {
  const v = T.view('win', { dataSource: 'topups' }, { failure: { kind: 'network' }, passes: { items: [{ name: 'Pass', gb: 5 }], at: now } }, now);
  assert.equal(v.hasData, true); assert.equal(v.activeSource, 'topups'); assert.equal(v.value, '5.0');
  assert.equal(v.planContext, 'Plan unavailable'); assert.equal(v.stale, false);
});
test('cached exhausted plan schedules concurrent passes even on small', async () => {
  const h = harness(); await h.ready();
  const state = h.read(); state.snapshot.remaining = 0; state.snapshot.used = 50; h.write(state);
  await h.run({}, { action: 'refresh' }, 'small');
  assert.equal(h.calls.some(call => call.url.endsWith('/pass')), true);
});
test('newly exhausted plan fetches passes on small without showTopups', async () => {
  const h = harness(); await h.ready();
  h.host.http.getResponse = async url => {
    const value = url.endsWith('/pass') ? passes() : offer();
    if (!url.endsWith('/pass')) { value.assets[1].balance.consumedValue = 50000; value.assets[1].balance.restValue = 0; }
    return { status: 200, body: JSON.stringify(value) };
  };
  const r = await h.run({}, { action: 'refresh' }, 'small');
  assert.equal(r.snapshot.remaining, 0); assert.equal(r.passes.items[0].gb, 5);
  assert.equal(T.view('win', {}, r, now).activeSource, 'topups');
});
test('deferred passes retry alone using a fresh exhausted plan', async () => {
  const h = harness(); await h.ready();
  const urls = [];
  h.host.http.getResponse = async url => {
    urls.push(url);
    if (url.endsWith('/pass')) return { status: 200, body: JSON.stringify(passes()) };
    h.advance(2500);
    const value = offer(); value.assets[1].balance.restValue = 0;
    value.assets[1].balance.consumedValue = 50000;
    return { status: 200, body: JSON.stringify(value) };
  };
  const first = await h.run({}, { action: 'refresh' }, 'small');
  assert.equal(first.failure, null); assert.equal(first.snapshot.remaining, 0);
  assert.ok(first.passes.error); assert.equal(urls.length, 1);
  const second = await h.run({}, {}, 'small');
  assert.equal(urls.length, 2); assert.match(urls[1], /\/pass$/);
  assert.equal(second.passes.items[0].gb, 5);
});
test('forcing top-ups on an active small widget fetches missing passes only', async () => {
  const h = harness(); await h.ready(); const n = h.calls.length;
  const r = await h.run({ dataSource: 'topups' }, {}, 'small');
  assert.equal(h.calls.length, n + 1); assert.match(h.calls.at(-1).url, /\/pass$/);
  assert.equal(T.view('win', { dataSource: 'topups' }, r, now).value, '5.0');
});
test('dataSource plan with no optional top-ups never requests passes on exhaustion', async () => {
  const h = harness(); await h.ready();
  const s = h.read(); s.snapshot.remaining = 0; s.snapshot.used = 50; h.write(s);
  await h.run({ dataSource: 'plan' }, { action: 'refresh' }, 'small');
  assert.equal(h.calls.some(call => call.url.endsWith('/pass')), false);
});
test('a pass-only 401 invalidates access auth for the next execution', async () => {
  const h = harness(); await h.ready();
  h.host.http.getResponse = async () => ({ status: 401, body: '{}' });
  const r = await h.run({ dataSource: 'topups' }, {}, 'small');
  assert.equal(r.failure, null); assert.ok(r.passes.error);
  assert.equal(h.read().auth.accessToken, undefined);
});
test('Orange switches using included top-ups without an extra endpoint', async () => {
  const h = harness('orange'); await h.ready();
  const endpoints = [];
  h.host.http.getResponse = async url => {
    endpoints.push(url);
    const b = orangeBalance(); b.items[0].valueItems[0].value = 0;
    return { status: 200, body: JSON.stringify(b) };
  };
  const r = await h.run({}, { action: 'refresh' }, 'small');
  const v = T.view('orange', {}, r, now);
  assert.equal(v.activeSource, 'topups'); assert.equal(v.value, '2.0');
  assert.equal(endpoints.length, 1); assert.match(endpoints[0], /\/balances\//);
});
test('freshness threshold and ended-cycle data are clearly stale', () => {
  const snapshot = T.win(offer(), {}, now);
  assert.equal(T.view('win', {}, { snapshot }, now + 3600001).stale, true);
  assert.equal(T.view('win', { staleAfterMinutes: 1440 }, { snapshot }, Date.parse('2026-11-01Z')).stale, true);
});
test('malformed provider data is rejected; sanitized result excludes credentials/tokens', async () => {
  assert.throws(() => T.orange({}, {}, now), /Invalid/);
  assert.throws(() => T.win({}, {}, now), /Invalid/);
  const h = harness(); const r = await h.ready();
  const text = JSON.stringify(r);
  assert.equal(text.includes('fake-only'), false); assert.equal(text.includes('synthetic-refresh'), false);
  assert.equal(text.includes('fixture@example.invalid'), false);
});
