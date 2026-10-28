// Compile with the actual upstream ScriptWidget preset, then exercise the
// generated layouts using mocked native APIs. This is not a SwiftUI renderer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const [babelPath, outputDir] = process.argv.slice(2);
if (!babelPath || !outputDir) throw new Error('Usage: node verify-packages.mjs /path/to/upstream/core.js /path/to/built-widgets');
const compiler = vm.createContext({});
vm.runInContext(readFileSync(babelPath, 'utf8'), compiler);
let checked = 0;
for (const provider of ['orange', 'win']) {
  const original = readFileSync(resolve(outputDir, provider + '-usage.jsx'), 'utf8');
  const variants = [
    { name: 'ready', ready: true },
    { name: 'remaining-light-topups', ready: true, remaining: true, light: true, topups: true },
    { name: 'stale', ready: true, stale: true },
    { name: 'setup', ready: false },
    { name: 'invalid-config', ready: false, invalid: true },
    { name: 'parameter-overrides', ready: true, parameter: '{"headline":"remaining","appearance":"light","label":"My line","showTopups":true}' },
    { name: 'invalid-parameter', ready: false, parameter: 'not-json', parameterError: true },
    { name: 'auto-light-device', ready: true, deviceDark: false },
    { name: 'auto-throwing-device', ready: true, deviceThrows: true },
    { name: 'forced-dark', ready: true, parameter: '{"appearance":"dark"}', forcedDark: true },
    { name: 'exhausted-auto', ready: true, exhausted: true, topupFocus: true },
    { name: 'forced-topups', ready: true, parameter: '{"dataSource":"topups"}', topupFocus: true },
    { name: 'missing-topups', ready: true, exhausted: true, topupFocus: true, missingPasses: true },
    { name: 'stale-topups', ready: true, exhausted: true, topupFocus: true, stalePasses: true },
    { name: 'ended-cycle', ready: true, endedCycle: true },
    { name: 'small-pass', ready: true, exhausted: true, topupFocus: true, smallPass: true },
  ];
  for (const variant of variants) {
    let source = original;
    if (variant.remaining) source = source.replace('headline: "used"', 'headline: "remaining"');
    if (variant.light) source = source.replace('appearance: "auto"', 'appearance: "light"');
    if (variant.topups) source = source.replace('showTopups: false', 'showTopups: true');
    if (variant.invalid) source = source.replace('accentColor: ""', 'accentColor: "invalid"');
    const js = compiler.Babel.transform('async function $main() {\n' + source + '\n}', { presets: ['scriptwidget'] }).code;
    new vm.Script(js);
    for (const size of ['small', 'medium', 'large']) {
      let rendered;
      const now = Date.now(), values = new Map(), logs = [];
      if (variant.ready) values.set('telecom-' + provider + '-v1', JSON.stringify({
        identity: provider === 'orange' ? ':null' : ':',
        credentials: { email: 'mock@example.invalid', password: 'not-real' },
        snapshot: { orangeDataVersion: 2, winDataVersion: 2, total: 60, used: 32.4, remaining: 27.6, observedAt: now - (variant.stale ? 7200000 : 1000), fetchedAt: now,
          plan: 'Synthetic plan', cycle: { start: now - 20 * 864e5, end: now + 10 * 864e5, estimated: provider === 'orange' },
          pace: { status: 'reserve', difference: 7.6, fraction: 0.667, expected: 40 }, calls: '2 h', sms: 'Unlimited' },
        passes: { items: [{ name: 'Synthetic top-up', gb: 2 }], at: now, fetchedAt: now },
      }));
      if (variant.exhausted || variant.missingPasses || variant.stalePasses || variant.endedCycle || variant.smallPass) {
        const key = 'telecom-' + provider + '-v1', state = JSON.parse(values.get(key));
        if (variant.exhausted) { state.snapshot.remaining = 0; state.snapshot.used = 60; }
        if (variant.missingPasses) {
          // Retain an unavailable diagnostic, so it may be rendered without
          // claiming a successful empty response. Mocked network rejects too.
          state.passes = { items: null, at: null, error: 'Unavailable' };
          // A native app would try to recover using its saved auth; no auth in
          // this render-only fixture avoids inventing a successful request.
          delete state.credentials;
        }
        if (variant.stalePasses) state.passes.at = now - 7200000;
        if (variant.endedCycle) state.snapshot.cycle.end = now - 1000;
        if (variant.smallPass) state.passes.items[0].gb = provider === 'orange' ? 802 / 1024 : 0.802;
        values.set(key, JSON.stringify(state));
      }
      const context = vm.createContext({
        console: { log: text => logs.push(text) },
        $storage: { getString: k => values.get(k) || '', setString: (k, v) => { values.set(k, v); return true; } },
        $http: { get: async () => { throw new Error('Unexpected network'); } },
        $getenv: key => key === 'widget-size' ? size : key === 'widget-param' ? variant.parameter || '' : '',
        $device: { isdarkmode: () => {
          if (variant.deviceThrows) throw new Error('Auto must not inspect the JS appearance flag');
          return variant.deviceDark !== false;
        } },
        ScriptWidget: { createElement: (tag, props, ...children) => {
          if (typeof tag === 'function') return tag({ ...props, children });
          return { tag, props, children: children.filter(x => x != null) };
        } },
        $render: node => { assert.equal(rendered, undefined, 'only one render allowed'); rendered = node; },
      });
      vm.runInContext(js, context);
      await context.$main();
      assert.equal(rendered.tag, 'vstack');
      const tree = JSON.stringify(rendered);
      assert.equal(tree.includes('not-real'), false);
      assert.equal(tree.includes('mock@example'), false);
      assert.ok(logs.every(line => !line.includes('not-real')));
      if (variant.ready && !variant.topupFocus) assert.ok(tree.includes('32.4') || tree.includes('27.6'));
      if (variant.stale) assert.ok(tree.includes('⚠'));
      if (variant.light) assert.equal(rendered.props.background, '#f5f5f7');
      if (variant.invalid || variant.parameterError) assert.ok(tree.includes('Settings error'));
      if (variant.invalid || variant.parameterError) assert.equal(values.size, 0, 'invalid settings do not write shared storage');
      if (variant.remaining) assert.ok(size === 'large' ? tree.includes('GB used') : tree.includes('Bar: used'));
      if (variant.name === 'parameter-overrides') {
        assert.ok(tree.includes('27.6')); assert.ok(tree.includes('My line'));
        assert.equal(rendered.props.background, '#f5f5f7');
        assert.equal(Array.from(values.values()).some(value => value.includes('My line')), false);
      }
      if (variant.forcedDark) assert.equal(rendered.props.background, '#16181c');
      if (!variant.light && variant.name !== 'parameter-overrides' && !variant.forcedDark) {
        assert.equal(rendered.props.background, '', 'auto uses native container background, not a JS-selected hex');
        assert.ok(tree.includes('"color":"primary"'));
        assert.equal(tree.includes('#f5f5f7'), false);
        assert.equal(tree.includes('#16181c'), false);
      }
      if (variant.topupFocus) {
        assert.ok(tree.includes('TOP-UPS'));
        assert.ok(tree.includes(variant.missingPasses ? 'Top-ups unavailable' : variant.smallPass ? '802' : '2.0'));
        if (variant.smallPass) assert.ok(tree.includes('"MB"'));
        assert.equal(tree.includes('GB expected'), false);
        assert.equal(tree.includes('Bar: used'), false);
        assert.equal(tree.includes('120,11'), false);
        if (variant.exhausted) assert.ok(tree.includes('Plan exhausted'));
        if (variant.stalePasses || variant.missingPasses) assert.ok(tree.includes('⚠'));
      }
      if (variant.endedCycle) {
        assert.ok(tree.includes('Cycle dates outdated'));
        assert.equal(tree.includes('GB reserve'), false);
        assert.equal(tree.includes('GB expected'), false);
        assert.ok(!tree.includes('⚠ just now'));
      }
      function checkMeter(node) {
        if (!node || typeof node !== 'object') return;
        if (node.tag === 'zstack' && /^(120|270),11$/.test(node.props.frame)) {
          const width = Number(node.props.frame.split(',')[0]);
          // The native ZStack ignores alignment and centres each child.
          // Every overlay must therefore occupy the complete track width.
          for (const overlay of node.children.filter(child => child.tag === 'hstack')) {
            assert.equal(overlay.props.frame, width + ',11');
            assert.equal(overlay.props.spacing, '0');
            const total = overlay.children.reduce((sum, child) => sum + Number(child.props.frame.split(',')[0]), 0);
            assert.ok(Math.abs(total - width) < 1e-8, 'fixed overlay children span track width');
          }
          const fillLayer = node.children[1];
          assert.equal(fillLayer.tag, 'hstack', 'fill cannot be a centred narrow direct child');
        }
        if (Array.isArray(node)) node.forEach(checkMeter);
        else (node.children || []).forEach(checkMeter);
      }
      checkMeter(rendered);
      checked++;
    }
  }
}
console.log(`Upstream JSX compilation + ${checked} mocked layout executions passed.`);
