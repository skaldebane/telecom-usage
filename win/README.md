# inwi win CLI

Minimal, dependency-free CLI for viewing win by inwi plan allowances and
additional pass balances through the public My win web API.

## Usage

Install the `win` command under `~/.local/bin`:

```console
make install
```

```console
win
win plan
win topups
win --json
win plan --json
win login
win logout
```

On the first run, `win` asks for the account email and password, verifies them,
and stores them in `~/.local/share/inwi-win/config.toml` with permissions `600`.
The API's access and refresh tokens are stored separately in the same directory
with permissions `600`; access tokens are refreshed automatically.

The human-readable plan output reports internet usage rather than remaining
data. Its pace compares usage against the cycle start/end on the plan's `OFFER`
asset. Individual Internet balances can retain last cycle's dates after renewal,
so their dates (including future dates and balance expiry) are not used to infer
the active billing cycle. Missing/invalid plan dates or times outside the cycle
suppress pace, as do the first 3% of a cycle. Pace uses the same reserve/deficit
wording as the Orange CLI. Pass balances are shown separately under
`Top-ups:`.

JSON output excludes passwords, tokens, and the SIM PUK.

Remove the installed command and data with `make uninstall`.

Run the billing-cycle regression tests from the repository root:

```console
python3 -m unittest discover -s win -p 'test_*.py'
```
