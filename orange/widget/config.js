const PROVIDER = "orange";
// Per-instance overrides: Edit Widget → Parameter, e.g.
// {"headline":"remaining","showTopups":true,"appearance":"dark"}
// Blank Parameter uses these defaults. Never put credentials in Parameter.
const CONFIG = {
  headline: "used", // "used" | "remaining"; bar always shows consumption
  dataSource: "auto", // "auto" switches to top-ups at plan exhaustion; "plan" | "topups"
  appearance: "auto", // "auto" | "light" | "dark"
  accentColor: "", // empty = provider default, or #RRGGBB
  label: "",
  showPace: true,
  showTopups: false, // medium/large only; separate from subscription quota
  showCallsSms: true, // large only
  decimalPlaces: 1,
  selection: "", // optional exact MSISDN returned by Orange, never another line
  quotaGBOverride: null, // fallback only when the plan name has no GB quota
  minimumFetchIntervalMinutes: 15,
  staleAfterMinutes: 60,
  networkBudgetMs: 3500, // clamped to 2000–3500
};
// Enter ON YOUR PHONE, run Preview to save, then blank these two fields again.
// Credentials/tokens are persisted in ScriptWidget storage (NOT Keychain).
// Never export/share a script with credentials in it.
const SETUP = { email: "", password: "", action: "normal" };
// action: "normal" | "refresh" (bypass recent cache) | "logout" (clear state).
