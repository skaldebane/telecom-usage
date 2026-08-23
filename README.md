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
