# Telecom Usage

Dependency-free CLIs for monitoring Moroccan mobile plan allowances:

- `orange`: Orange Maroc plans through the Max it API
- `win`: win by inwi plans through the My win API

## Install

Install both commands under `~/.local/bin`:

```console
make install
```

Install or remove one provider independently:

```console
make install-orange
make install-win
make uninstall
```

Each CLI has its own commands and authentication state:

```console
orange
orange --json
win
win --json
```

Provider credentials and tokens remain outside Git and are stored separately:

```text
~/.local/share/orange/
~/.local/share/inwi-win/
```

See [`orange/README.md`](orange/README.md) and [`win/README.md`](win/README.md)
for provider-specific details.

## iOS widgets

[Standalone ScriptWidget widgets](scriptwidget/README.md) for Orange and win
support small, medium, and large iOS layouts, cached authentication, usage pace,
and stale-data fallback. Build credential-free `.swt` imports with:

```console
python3 scriptwidget/build.py
```

Builds go into the Git-ignored `dist/scriptwidget/` directory.

The [runtime probe](scriptwidget/probe/README.md) checks networking, persistence,
and timeout behavior on the installed iOS app.
