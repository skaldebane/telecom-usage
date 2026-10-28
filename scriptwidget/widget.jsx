// Runs after CONFIG, SETUP, timezone data and shared core in the built package.
const widgetStarted = Date.now();
const familyText = typeof $getenv === "function" ? String($getenv("widget-size")) : "medium";
const family = /small/i.test(familyText) ? "small" : /large/i.test(familyText) ? "large" : "medium";
let data;
let effectiveConfig = CONFIG;
try {
  effectiveConfig = Telecom.instanceConfig(CONFIG, typeof $getenv === "function" ? $getenv("widget-param") : "");
} catch (error) {
  effectiveConfig = {};
  data = { note: "Settings error: " + String(error.message) };
}
try {
  if (!data) data = await Telecom.refresh(PROVIDER, effectiveConfig, SETUP, {
    now: () => Date.now(),
    storage: typeof $storage === "undefined" ? null : $storage,
    http: typeof $http === "undefined" ? {} : $http,
  }, family);
} catch (error) {
  // Never print response bodies, raw network errors, credentials or tokens.
  data = { failure: { kind: error.code === "storage" ? "storage" : "response" },
    note: error.code ? "" : "Check CONFIG values and runtime compatibility." };
}
const v = Telecom.view(PROVIDER, effectiveConfig, data, Date.now());
// Auto delegates to SwiftUI's live color scheme, not a JS appearance snapshot.
// An empty background resolves to no authored color, so the native widget
// container uses its semantic .background. Named colors adapt at native render.
const colors = v.c.appearance === "auto"
  ? { bg: "", fg: "primary", secondary: "secondary", track: "secondary,0.2", panel: "secondary,0.1", good: "green", warning: "orange" }
  : v.c.appearance === "dark" ? { bg: "#16181c", fg: "#f4f5f7", secondary: "#a8adb7", track: "#30343c", panel: "#22252b", good: "#85d2b0", warning: "#efb277" }
  : { bg: "#f5f5f7", fg: "#17191e", secondary: "#626873", track: "#dedfe4", panel: "#e9eaee", good: "#23704e", warning: "#9a4a16" };
const ageText = v.age;
const headline = <hstack alignment="firstTextBaseline" spacing="5">
  <text font={family === "large" ? "largeTitle" : "title"} fontWeight="bold" fontDesign="rounded" color={colors.fg}>{v.value}</text>
  <text font="caption" color={colors.secondary}>{v.unit}</text>
</hstack>;

function Meter(props) {
  const width = props.width;
  if (v.percent == null) return <text font="caption2" color={colors.secondary}>Usage unavailable</text>;
  const fill = Math.max(0, Math.min(width, width * v.percent));
  const marker = v.pace ? Math.max(0, Math.min(width - 2, width * v.pace.fraction)) : 0;
  // ScriptWidget builds a centred ZStack even when alignment="leading".
  // Make each overlay exactly the track width; its fixed child widths then
  // place the fill/marker from the leading edge without relying on ZStack.
  return <zstack frame={width + ",11"}>
    <rect frame={width + ",6"} color={colors.track} corner="3" />
    <hstack spacing="0" frame={width + ",11"}>
      {fill > 0 ? <rect frame={fill + ",6"} color={v.accent} corner="3" /> : null}
      <rect frame={(width - fill) + ",1"} color="clear" />
    </hstack>
    {v.pace ? <hstack spacing="0" frame={width + ",11"}>
      <rect frame={marker + ",1"} color="clear" /><rect frame="2,11" color={colors.secondary} />
      <rect frame={(width - marker - 2) + ",1"} color="clear" />
    </hstack> : null}
  </zstack>;
}
function Pace() {
  return v.notice ? <text font="caption2" color={colors.warning}>{"⚠ " + v.notice}</text>
    : v.pace ? <text font="caption2" color={v.pace.bad ? colors.warning : colors.good}>{v.pace.text}</text>
    : <text font="caption2" color={colors.secondary}>{v.c.showPace ? "Pace unavailable" : "Subscription data"}</text>;
}
function Row(props) {
  return <hstack spacing="8"><text font="caption" color={colors.secondary}>{props.label}</text><spacer />
    <text font="caption" color={props.warning ? colors.warning : colors.fg}>{props.value}</text></hstack>;
}
const header = <hstack spacing="5">
  <rect frame="7" color={v.accent} corner="2" />
  <text font="caption" fontWeight="semibold" color={colors.fg}>{v.label.slice(0, family === "small" ? 12 : 24)}</text>
  <spacer />
  <text font="caption2" color={colors.secondary}>{ageText}</text>
</hstack>;
const topupText = v.topups + (v.topupsStale ? " · stale" : "");
let layout;
if (!v.hasData) {
  layout = <vstack frame="max" alignment="leading" spacing="10" padding="16" background={colors.bg}>
    {header}
    <text font="headline" color={colors.fg}>{v.error ? "Refresh unavailable" : "Setup"}</text>
    <text font="caption" color={colors.secondary}>{v.note || v.error || "Run Preview to continue setup."}</text>
    <text font="caption2" color={colors.secondary}>No balance saved yet.</text>
  </vstack>;
} else if (v.activeSource === "topups") {
  // Pass APIs do not reliably supply initial quota, usage history or renewal.
  // Never reuse the plan's meter/pace as though it described a top-up.
  const source = <text font="caption2" fontWeight="semibold" color={v.accent}>TOP-UPS</text>;
  const cached = v.notice ? "⚠ " + v.notice : "Separate data balance";
  if (family === "small") {
    layout = <vstack frame="max" alignment="leading" spacing="5" padding="14" background={colors.bg}>
      {header}{source}{headline}<text font="caption2" color={colors.secondary}>{v.sub}</text>
      <spacer />
      {v.notice ? <text font="caption2" color={colors.warning}>{"⚠ " + v.notice}</text> : null}
      <text font="caption2" color={colors.secondary}>{v.planContext}</text>
    </vstack>;
  } else if (family === "medium") {
    layout = <vstack frame="max" alignment="leading" spacing="5" padding="14" background={colors.bg}>
      {header}<hstack alignment="top" spacing="16">
        <vstack alignment="leading" spacing="4">{source}{headline}<text font="caption2" color={colors.secondary}>{v.sub}</text></vstack>
        <spacer /><vstack alignment="leading" spacing="6"><text font="caption2" color={colors.secondary}>PLAN</text>
          <text font="caption" color={colors.fg}>{v.planContext}</text><text font="caption2" color={colors.secondary}>{v.planAge}</text>
        </vstack>
      </hstack><spacer /><text font="caption2" color={v.stale ? colors.warning : colors.secondary}>{cached}</text>
    </vstack>;
  } else {
    layout = <vstack frame="max" alignment="leading" spacing="6" padding="18" background={colors.bg}>
      {header}{source}{headline}<text font="caption" color={colors.secondary}>{v.sub}</text>
      <Row label="Subscription" value={v.planContext} /><Row label="Plan cycle" value={v.cycle} />
      {v.topupItems.slice(0, 2).map(item => <Row label={item.name.slice(0, 18)} value={item.gb.toFixed(v.c.decimalPlaces) + " GB left"} />)}
      {v.topupItems.length > 2 ? <text font="caption2" color={colors.secondary}>{"+ " + (v.topupItems.length - 2) + " more data passes included"}</text> : null}
      {v.c.showCallsSms ? <Row label="Calls remaining" value={v.calls} /> : null}
      {v.c.showCallsSms ? <Row label="SMS remaining" value={v.sms} /> : null}
      <spacer /><text font="caption2" color={v.stale ? colors.warning : colors.secondary}>{cached}</text>
      <text font="caption2" color={colors.secondary}>Pass traffic restrictions may apply.</text>
    </vstack>;
  }
} else if (family === "small") {
  layout = <vstack frame="max" alignment="leading" spacing="5" padding="14" background={colors.bg}>
    {header}<spacer />{headline}
    <text font="caption2" color={colors.secondary}>{v.sub}</text>
    <Meter width={120} /><Pace />
    {v.c.headline === "remaining" ? <text font="caption2" color={colors.secondary}>Bar: used</text> : null}
  </vstack>;
} else if (family === "medium") {
  layout = <vstack frame="max" alignment="leading" spacing="4" padding="14" background={colors.bg}>
    {header}
    <hstack alignment="top" spacing="20">
      <vstack alignment="leading" spacing="4">{headline}<text font="caption2" color={colors.secondary}>{v.sub}</text>
        <Meter width={120} />
      </vstack>
      <spacer />
      <vstack alignment="leading" spacing="6"><text font="caption2" color={colors.secondary}>RENEWS</text>
        <text font="caption" fontWeight="semibold" color={colors.fg}>{v.renewal}</text><Pace />
      </vstack>
    </hstack>
    <spacer />
    <text font="caption2" color={v.stale ? colors.warning : colors.secondary}>{(v.c.headline === "remaining" ? "Bar: used · " : "") + (v.stale ? "Cached · " + (v.error ? "refresh failed" : "balance not current") : v.note || v.plan.slice(0, 24))}</text>
    {v.c.showTopups ? <text font="caption2" color={v.topupsStale ? colors.warning : colors.secondary}>{topupText + " · " + v.topupsAge}</text> : null}
  </vstack>;
} else {
  layout = <vstack frame="max" alignment="leading" spacing="5" padding="18" background={colors.bg}>
    {header}{headline}<text font="caption" color={colors.secondary}>{v.sub}</text>
    <Meter width={270} />
    <hstack><text font="caption2" color={colors.secondary}>{v.used}</text><spacer /><text font="caption2" color={colors.secondary}>{v.remaining}</text></hstack>
    {v.pace ? <vstack frame="max,42" alignment="leading" spacing="3" padding="6" background={colors.panel} corner="10">
      <Pace /><text font="caption2" color={colors.secondary}>{v.pace.expected}</text>
    </vstack> : null}
    <Row label="Cycle" value={v.cycle} />
    {v.c.showCallsSms ? <Row label="Calls remaining" value={v.calls} /> : null}
    {v.c.showCallsSms ? <Row label="SMS remaining" value={v.sms} /> : null}
    {v.c.showTopups ? <Row label="Top-ups" value={topupText} warning={v.topupsStale} /> : null}
    {v.c.showTopups ? <text font="caption2" color={colors.secondary}>{"Top-ups: " + v.topupsAge}</text> : null}
    <spacer />
    <text font="caption2" color={v.notice ? colors.warning : colors.secondary}>{v.notice ? "⚠ " + v.notice : v.note || v.plan.slice(0, 36)}</text>
  </vstack>;
}
// A safe diagnostic only; never log the snapshot, SETUP or persisted state.
if (typeof console !== "undefined" && typeof console.log === "function") console.log(JSON.stringify({
  provider: PROVIDER, family: family, dataSource: v.activeSource, cached: v.hasData, stale: v.stale, notice: v.notice,
  failure: data.failure ? data.failure.kind : null, elapsedMs: Date.now() - widgetStarted,
}));
$render(layout);
