# ScriptWidget iOS runtime probe

Credential-free diagnostic for the installed app, before building the telecom
widgets. Uses **one public HTTPS request per execution**, not either provider's
authenticated API. It measures host API compatibility and timeout behavior, not
carrier latency. The public httpbingo.org service sees your IP and normal request
metadata. No credentials, carrier responses, or device identifiers are sent.

## Install

Import `Telecom-Runtime-Probe.swt` into ScriptWidget using its import/share flow.
Alternatively, create a blank widget and paste `main.jsx` into the editor. If the
app supports package permissions, allow **network** to `httpbingo.org` and
**storage**. Use a **medium or large** widget; the small size is too cramped.

If package import is rejected, report the exact error and use the paste route to
check the older runtime. The script feature-detects newer APIs; no `$runtime`
version being exposed is a valid diagnostic result.

## Run these tests in order

Edit **only `MODE` at the top of `main.jsx`**, save, and run the preview:

1. **`baseline`** (default): request public JSON, report API version/advertised
   limit, verify a storage write/readback, and cache the successful timing.
2. **`baseline` again**: the run number should increase and previous should say
   `baseline / completed`. This checks persistence across executions, not just
   an immediate readback. Close/reopen the app and test again, then select the
   same script in a medium Home Screen widget to check app-to-widget persistence.
   Home Screen scheduling is controlled by iOS; check timestamps to distinguish
   a new execution from an old snapshot. Concurrent previews/refreshes can race
   on this diagnostic's counter; it is not an atomic execution counter.
3. **`timeout`**: request a 3-second delay with a 1-second request timeout. Expect
   a caught failure and the cached baseline still present. Check the console's
   error and duration: a rejection alone does not prove the timeout worked.
   If it succeeds after 3+ seconds, the host may ignore the timeout option.
4. **`deadline`** (**optional, deliberately disruptive**): request a 7-second
   delay with a 10-second request timeout. A five-second runtime may terminate
   execution without reaching the error handler or layout. Take a screenshot of
   the runtime error and record the wall-clock duration. Do not leave this mode
   selected on your Home Screen.
5. Immediately switch to **`inspect`** and run: no network request. Check
   `Previous: deadline / waiting for network`. This is evidence that the earlier
   run did not finish, **not proof of why** (app termination can do the same).
   `deadline / completed` means it reached its handler; inspect its console
   report for success, request timeout, or other failure.
6. Return to **`baseline`**. Optionally turn on Airplane Mode with Wi-Fi disabled
   and rerun to check caught offline failure with a retained cache.

Send back screenshots of the baseline and timeout results, the full JSON
`probe-report` console entries, and any deadline error plus the following inspect
result. No passwords or tokens are involved.

## What this does not claim

- A stored baseline is a diagnostic snapshot, not cached telecom data.
- Only one final `$render` is called. Rendering before a pending request is not
  assumed to allow background completion or survive cancellation.
- The script's elapsed time starts after compilation; a native host's total
  deadline may include compilation/setup. iOS tests are necessary.
- Storage is UserDefaults in current upstream, not Keychain. Copying/reimporting
  a script may change its namespace and reset the diagnostic history.
- The probe endpoint may be slow/down. Its error is not automatically an app bug.

## Build and local tests

From the repository root:

```sh
node --test scriptwidget/probe/probe.test.mjs
python3 scriptwidget/probe/build.py /tmp/opencode/Telecom-Runtime-Probe.swt
```

The tests execute the actual pre-layout JavaScript with mocked host APIs. They
do not validate native JSX rendering, iOS persistence, or cancellation behavior.
The archive contains only `widget.json` and `main.jsx`.
