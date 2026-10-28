# Standalone ScriptWidget telecom widgets

Two independent iOS packages: **Orange Usage** and **win Usage**. No server,
Python runtime, external JS library, or public data service is used on the phone.
They call only their provider's HTTPS API. The existing Python CLIs are unchanged.

## Install and sign in on your iPhone

1. Download/import `orange-usage.swt` and/or `win-usage.swt` into ScriptWidget,
   just as you imported the probe. Allow the declared network/storage permissions.
   Alternatively paste the corresponding **built** `*-usage.jsx` into a blank
   widget. Do not paste `widget.jsx` or `config.js` alone; they are source parts.
2. Open `main.jsx`. At the very top, find `SETUP` and enter your provider's email
   and password as quoted JavaScript strings. Escape any `"` or `\` in the
   password. **Enter credentials only on your own phone, not in chat or Git.**
3. Run Preview. Credentials are saved before networking; blank the `email` and
   `password` strings in `SETUP` again and save. Do not change `CONFIG` or the
   package identity between setup stages.
4. Run Preview again until a balance appears: Orange usually needs **two runs**
   total (login, balances); win **three** (login, line lookup, offer). A session
   refresh or timed-out request can need another run. Staging intentionally avoids
   combining slow authentication/discovery/balances under one five-second limit.
5. Add a ScriptWidget Home Screen widget in **small, medium, or large**, and select
   the same script. Test persistence by confirming the balance remains available
   without putting credentials back into its source. iOS controls refresh timing.

**Credential warning:** ScriptWidget's `$storage` is not Keychain. These widgets
persist your password so expired sessions can recover without a server. Tokens
are also persisted. Keep that security tradeoff in mind. Never share/export code
containing populated SETUP fields. Clearing source fields does not erase saved
credentials; use `action: "logout"` to erase this widget's persisted state.

## Controls

### Per-instance settings without code edits

On the Home Screen, long-press a widget → **Edit Widget** → **Parameter**. Paste
a JSON object, for example:

```json
{"headline":"remaining","appearance":"dark","showTopups":true}
```

Each Home Screen instance has its own Parameter string. Two instances can use
the same script with different labels, appearance, headline, precision and pace
options. They still share the script's account, session and cached provider data.
Overrides are read through `$getenv("widget-param")` for that execution only;
they are **not** written into shared storage or over the script's `CONFIG`.

The app's **Preview Settings → Parameter → Apply** is a separate test input,
not the Home Screen instance's value. Blank Parameter or `{}` uses the script's
defaults. Use normal JSON double quotes and actual booleans (`true`, not
`"true"`). Invalid JSON, unsupported keys, wrong types, or out-of-range numeric
values produce a visible settings error and make no network/storage changes.

Allowed Parameter keys: `headline`, `dataSource`, `appearance`, `accentColor`, `label`,
`showPace`, `showTopups`, `showCallsSms`, `decimalPlaces`,
`minimumFetchIntervalMinutes`, `staleAfterMinutes`, and `networkBudgetMs`.

**Never put credentials in Parameter.** `selection`, `quotaGBOverride`, SETUP
credentials and actions remain script-level. This avoids different instances
switching the shared account/line or reinterpreting the same cached quota. For
different accounts, use separate installed script copies with separate storage.
Enabling top-ups can populate their shared data cache, but never overwrites another
instance's display settings. Fetch/stale thresholds apply per execution; they
do not create independent authentication sessions or network caches.

### Script defaults and account settings

You can still change the `CONFIG` block near the top of each script. Parameter
values take precedence over these defaults for allowed keys:

| Setting | Default | Meaning |
| --- | --- | --- |
| `headline` | `"used"` | `"used"` or `"remaining"`. Bar always represents **consumed** data. |
| `dataSource` | `"auto"` | Smart switch to top-ups when the plan has zero remaining. `"plan"` keeps the subscription meter; `"topups"` always focuses top-ups, including on small. Top-up headlines always mean **remaining**, independent of `headline`. |
| `appearance` | `"auto"` | Native system-adaptive background/text, or fixed `"light"`/`"dark"` palettes. Auto does not depend on `$device.isdarkmode()`. |
| `accentColor` | `""` | Provider color, or `"#RRGGBB"`. Status colors remain distinct. |
| `label` | `""` | Optional custom title. Full phone number is never shown by default. |
| `showPace` | `true` | Reserve/deficit, expected-consumption marker; expanded context on large. |
| `showTopups` | `false` | Optional secondary top-up summary on medium/large while the plan is primary. Small skips this optional summary, but still fetches/shows top-ups when `dataSource` requires them. |
| `showCallsSms` | `true` | Show available calls/SMS on large only; no extra request. |
| `decimalPlaces` | `1` | Data values: 0, 1, or 2 decimal places. |
| `selection` | `""` | **Script-only.** Automatic active subscription, or exact account-owned win subscription ID. Orange can validate its login-returned MSISDN, but cannot discover/switch other lines through this API. |
| `quotaGBOverride` | `null` | **Script-only.** Orange quota fallback if both gauge total and plan-name quota are absent. Ignored by win. |
| `minimumFetchIntervalMinutes` | `15` | Skip duplicate requests while cache is recent. 0 disables this cache optimization. Does **not** schedule iOS updates. |
| `staleAfterMinutes` | `60` | Mark old balance snapshots stale. Request failure or unknown Orange observation time also marks them stale. Outdated cycle dates are a separate warning, not an old-balance claim. |
| `networkBudgetMs` | `3500` | Network-work target; clamped to 2000–3500. Per-request timeouts shrink to fit. |

`SETUP.action` is independent of display configuration:

- `"normal"`: usual operation.
- `"refresh"`: bypass recent-cache optimization. Run Preview, then restore normal.
- `"logout"`: erase the provider widget's credentials, sessions, and caches. Run
  Preview once, then clear SETUP credentials and restore normal. This does not
  revoke the carrier's session server-side.

Changing credentials or selection clears the old account/line snapshot. Changing
an Orange quota override also invalidates its snapshot. Display-only changes use
the existing cached balance. Do not change a package's ID or copy it during setup:
ScriptWidget can assign a different storage namespace to copies/reimports.

## Layout and data semantics

### Smart switch (including small)

The default `dataSource: "auto"` keeps the existing plan meter while reported
plan remaining is positive. Once it reaches zero (not merely rounded to 0.0),
the main figure becomes **top-ups remaining**, with a prominent TOP-UPS label
and the exhausted plan as secondary context. It switches back when a later plan
snapshot has data again. Unknown plan remaining does not imply exhaustion.

The pass APIs do not reliably provide initial quota or consumption history, so
top-up focus has **no percentage bar, monthly pace, or invented renewal date**.
Its header age and stale marker describe the top-up data. The large variant lists
up to two named data passes and reports how many others are included in the sum.
The sum is reported remaining data, not a promise that restricted passes cover
all traffic. Plan quota/cycle and calls/SMS remain explicitly plan context.

Headline units adapt below 1 GB: MB, KB, or bytes as needed. Orange uses its
existing binary /1024 conversion; win uses decimal /1000. A real zero shows
`0 MB`; a small positive balance is not rounded into `0.0 GB`. Unknown remains
unavailable, not zero. Top-up subtitles say remaining, or no data top-ups left
for a successfully fetched zero balance.

Force a particular focus per instance, without changing shared defaults:

```json
{"dataSource":"topups"}
```

Use `"plan"` to disable smart switching, or `"auto"` for the default behavior.
`showTopups: false` only hides the optional secondary summary; it does not prevent
the automatic main-balance switch.

Orange already includes top-ups in its balance response. For win, a known
exhausted plan starts passes concurrently with the offer. If the current offer
first reveals exhaustion, passes are attempted only within the remaining time
budget. If deferred, the next execution reuses the recent plan and fetches passes
alone. A forced top-up widget can likewise fetch missing passes without reloading
a recent plan. A failed/deferred request shows cached passes marked stale, or
“Top-ups unavailable”; only a successful empty pass response is treated as zero.

### Plan-focused layouts

- **Small:** title, observation age, primary data figure, consumed bar and pace.
- **Medium:** adds renewal and plan context; optional separate top-up summary.
- **Large:** adds cycle range, used/remaining breakdown, expected consumption,
  calls/SMS, and optional top-ups with their own age/stale state.
- The bar is consumed fraction in both headline modes; its thin marker is expected
  consumption at the balance's observation time, not a second live measurement.
- No historical chart: the APIs supply current snapshots, not a usage series.
- Pace is hidden for the first 3% of a cycle or missing/invalid cycle/quota data.
  Within two percentage points is on pace, matching the CLIs. A cached snapshot's
  pace is not recalculated as if its old balance were live.
- Pace is also hidden outside the returned billing cycle, including when a
  previously cached cycle has ended. A fresh balance with an ended cycle shows
  **Cycle dates outdated**, not a reserve/deficit at a clamped 100% of elapsed
  time. A pass/balance expiry date is not used to invent a new billing cycle.
  The header keeps the balance age; a separate readable status explains old
  balances, failed refreshes, or invalid cycle metadata instead of `⚠ just now`.
- Meter overlays occupy the full track width with fixed child widths. The native
  ScriptWidget ZStack centres children and ignores its `alignment` prop; a narrow
  fill rectangle cannot be placed directly in it without appearing centred.
- Orange renewal is **estimated** from the Morocco calendar month, as in its CLI;
  it is not an API-confirmed billing date. Build-time Africa/Casablanca timezone
  data handles offset changes (including Ramadan), independently of the phone's
  locale or optional `Intl` support. Rebuild for updated timezone rules. The
  bundled table covers 2020–2040; outside it Orange cycle/pace are unavailable.
- win uses the plan's `OFFER` asset cycle instants, shown as UTC calendar dates.
  Internet-balance assets can retain the previous period after renewal; their
  current/future cycle fields and balance expiry are not authoritative plan dates.
  Old normalized win snapshots are refetched after this fix without discarding
  saved credentials or line selection. Missing plan dates leave pace unavailable.
  win data units match the CLI's decimal conversions; Orange MB uses its CLI's /1024.
- Missing values are unavailable, not zero. Top-ups never inflate plan quota.
  Orange non-data top-ups are not included in the GB total.
- On a caught failure, retain the snapshot and original observation timestamp,
  visibly marked stale. With no snapshot, show setup/error instructions instead.
  Age labels reflect the latest render; iOS may keep that render on screen longer.
  A failed top-up request does not invalidate a fresh plan snapshot, and vice versa.

## Timing and runtime limits

The probe confirmed API **1.0**, storage persistence across app previews, and a
hard **five-second** runtime cutoff. Native Home Screen persistence and the actual
carrier layouts still require device testing. New optional APIs are detected;
GET can use `$http.getResponse` if available, or legacy `$http.get`.

Each API request gets `timeoutInterval` based on remaining network time. No new
request starts with less than ~1.05 seconds available (the upstream host clamps
timeouts to at least one second). Login, refresh and subscription discovery save
progress then finish that execution. There is no unbounded immediate auth/retry
loop. win starts plan/pass requests concurrently without assuming `Promise.all`
exists in ScriptWidget's custom Promise bridge.

This is a **best-effort** time budget, not an independent cancellation timer:
ScriptWidget owns the actual HTTP timeout and hard cutoff. Compilation, slow
streaming, or an ignored timeout can still cause a native timeout. A hard cutoff
cannot reliably execute a fallback handler. Please send the widget's sanitized
console line and runtime error if that happens; never send SETUP or storage data.

Token refresh rejection falls back to password login on a subsequent execution;
a transient network failure preserves the refresh token and retries later.
An expired/invalid Orange session is reacquired on a subsequent execution. The
legacy bridge cannot expose every HTTP status, so ambiguous unexpected responses
are reported rather than interpreted as zero balances.

## Build and test

From the repository root (Python 3 with system IANA tzdata, and Node for tests):

```sh
node --test scriptwidget/widgets.test.mjs scriptwidget/probe/probe.test.mjs
python3 -m unittest discover -s win -p 'test_*.py'
python3 scriptwidget/build.py
```

Build output defaults to the Git-ignored `dist/scriptwidget/` directory (pass an
output directory to override it). It contains `.swt` imports plus standalone `.jsx` files. Each archive
contains only `widget.json` and `main.jsx`; an explicit allowlist excludes Python
credential files and all authentication state. The builder refuses populated
SETUP fields in source configuration.

To check against the upstream compiler, download ScriptWidget's
`Shared/ScriptWidgetRuntime/Widget/Resource/support.bundle/core.js` separately,
then run:

```sh
node scriptwidget/verify-packages.mjs /path/to/upstream/core.js dist/scriptwidget
```

That compiles the JSX and checks mocked render trees in all sizes for both
providers. It is not a native SwiftUI screenshot test. Unit tests cover synthetic
response fixtures, auth staging/rotation, account separation, budget limits,
independent passes, cache retention, missing data and Morocco timezone behavior.

Source organization: per-provider `orange/widget/config.js` and
`win/widget/config.js`, plus shared `scriptwidget/core.js` and `widget.jsx`.
Shared source is bundled into each independent package; there is no phone-side
module loader or dependency between the two installed widgets.
