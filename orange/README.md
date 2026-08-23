# Orange Maroc CLI

Minimal, dependency-free CLI for viewing Orange Maroc plan allowances and
additional top-up balances through the Max it mobile API.

## Usage

Install the `orange` command under `~/.local/bin`:

```console
make install
```

```console
orange
orange plan
orange topups
orange --json
orange plan --json
orange login
orange logout
```

Use another credentials file with `--config path/to/config.toml`.

On the first run, `orange` asks for the account email and password, verifies
them, and stores them in `~/.local/share/orange/config.toml` with permissions
`600`. `orange login` replaces the saved login after confirmation, while
`orange logout` confirms and clears it. If saved credentials are rejected,
balance commands offer to start the login flow again.

The config is created on demand after a successful login. Reinstalling or
upgrading does not overwrite a saved login.

Remove the installed command and data with `make uninstall`.

For plans whose name contains the subscription quota, such as `YOXO 60GO`, the
human-readable output includes a usage progress bar. It also compares usage
with the expected linear pace from the first day of the current month at
midnight in Morocco through the first day of the next month. Pace is hidden for
the first 3% of a cycle, matching CodexBar's warm-up behavior. Additional
top-up data remains separate from the subscription meter.

JSON output preserves the unmodified balance fields returned by Orange.
