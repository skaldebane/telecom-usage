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
data. Its pace compares usage against the exact cycle start and end returned by
inwi, and uses the same reserve/deficit wording as the Orange CLI. The first
3% of a cycle suppresses pace. Pass balances are shown separately under
`Top-ups:`.

JSON output excludes passwords, tokens, and the SIM PUK.

Remove the installed command and data with `make uninstall`.
