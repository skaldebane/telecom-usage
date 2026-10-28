import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');
const logic = source.split('// Native widget layout.')[0];
const goodBody = JSON.stringify({ args: {}, headers: {}, url: 'https://httpbingo.org/get' });
const key = 'telecom-probe-v1';

function host(options = {}) {
  const values = options.values || new Map();
  const logs = [];
  const calls = [];
  const storage = {
    getString: k => values.get(k) || '',
    setString: (k, value) => { values.set(k, value); return true; },
  };
  const context = {
    $runtime: { apiVersion: '1.2', limits: { executionMilliseconds: 5000 } },
    $storage: storage,
    $getenv: () => 'medium',
    $http: {
      getResponse: async (url, params) => {
        calls.push({ url, params });
        return { status: 200, body: goodBody };
      },
    },
    console: { log: text => logs.push(JSON.parse(text)) },
    ...options.globals,
  };
  async function run(mode = 'baseline') {
    const script = '(async () => {' + logic.replace('const MODE = "baseline";', `const MODE = ${JSON.stringify(mode)};`) + '\nreturn report; })()';
    return await vm.runInNewContext(script, context, { timeout: 1000 });
  }
  return { values, logs, calls, run };
}

test('baseline persists across executions and exposes runtime metadata', async () => {
  const h = host();
  const first = await h.run();
  assert.equal(first.outcome, 'success');
  assert.equal(first.run, 1);
  assert.equal(first.previous, 'none');
  assert.equal(first.apiVersion, '1.2');
  assert.equal(first.limitMs, 5000);
  const second = await h.run();
  assert.equal(second.run, 2);
  assert.equal(second.previous, 'baseline / completed');
  assert.ok(second.cachedBaseline.at);
  assert.equal(h.calls[0].params.timeoutInterval, 3);
  assert.ok(h.calls[0].url.startsWith('https://httpbingo.org/get?probe='));
  assert.equal(h.logs.filter(x => x.event === 'probe-report').length, 2);
});

test('missing modern runtime and storage APIs do not prevent a result', async () => {
  const h = host({ globals: { $runtime: undefined, $storage: undefined } });
  const result = await h.run();
  assert.equal(result.apiVersion, 'not exposed');
  assert.equal(result.storage, 'unavailable');
  assert.equal(result.outcome, 'success');
});

test('legacy $http.get can return JSON text', async () => {
  const h = host({ globals: { $http: { get: async () => goodBody } } });
  const result = await h.run();
  assert.equal(result.outcome, 'success');
  assert.match(result.transport, /no status metadata/);
});

test('missing networking is reported, not thrown', async () => {
  const h = host({ globals: { $http: undefined } });
  const result = await h.run();
  assert.equal(result.outcome, 'no cached baseline');
  assert.match(result.error, /No supported/);
});

test('timeout rejection retains baseline without falsely diagnosing the error', async () => {
  let captured;
  const values = new Map();
  await host({ values }).run();
  const h = host({ values, globals: { $http: { getResponse: async (url, params) => {
    captured = { url, params };
    throw new Error('The request timed out');
  } } } });
  const result = await h.run('timeout');
  assert.equal(captured.params.timeoutInterval, 1);
  assert.match(captured.url, /delay\/3/);
  assert.equal(result.outcome, 'cached baseline retained');
  assert.match(result.error, /timed out/);
  assert.equal(JSON.parse(values.get(key)).attempt.stage, 'completed');
});

test('a successful timeout-mode request reports timeout not enforced', async () => {
  assert.equal((await host().run('timeout')).outcome, 'timeout not enforced');
});

test('HTTP errors and unexpected bodies never become a good cache', async () => {
  for (const response of [
    { status: 503, body: goodBody },
    { status: 200, body: '<html>unavailable</html>' },
    { status: 200, body: '{}' },
  ]) {
    const result = await host({ globals: { $http: { getResponse: async () => response } } }).run();
    assert.equal(result.outcome, 'no cached baseline');
    assert.equal(result.cachedBaseline, null);
    assert.ok(result.error);
  }
});

test('storage write failure is visible', async () => {
  const result = await host({ globals: { $storage: {
    getString: () => '', setString: () => false,
  } } }).run();
  assert.equal(result.storage, 'write/readback failed');
});

test('corrupt storage is reported without crashing', async () => {
  const h = host({ values: new Map([[key, 'not JSON']]) });
  assert.match((await h.run()).storage, /^error:/);
});

test('inspect reads an interrupted breadcrumb without any network call', async () => {
  const values = new Map();
  const h = host({ values, globals: { $http: { getResponse: () => new Promise(() => {}) } } });
  // Deliberately leave the request unresolved to examine its pre-await state.
  // This tests the breadcrumb, not native hard cancellation.
  h.run('deadline');
  assert.equal(JSON.parse(values.get(key)).attempt.stage, 'waiting for network');
  const inspector = host({ values });
  const result = await inspector.run('inspect');
  assert.equal(result.previous, 'deadline / waiting for network');
  assert.equal(result.previousCompleted, false);
  assert.equal(inspector.calls.length, 0);
  assert.equal(result.outcome, 'inspection only');
});

test('invalid mode makes no network call', async () => {
  const h = host();
  assert.equal((await h.run('typo')).outcome, 'invalid mode');
  assert.equal(h.calls.length, 0);
});

test('manifest contains only required permissions and an existing entry', () => {
  const manifest = JSON.parse(readFileSync(new URL('./widget.json', import.meta.url)));
  assert.deepEqual(manifest.permissions, ['network', 'storage']);
  assert.deepEqual(manifest.networkDomains, ['httpbingo.org']);
  assert.equal(manifest.entry, 'main.jsx');
  assert.equal(manifest.formatVersion, 2);
  assert.equal(source.includes('const MODE = "baseline";'), true);
});
