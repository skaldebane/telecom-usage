#!/usr/bin/env python3
"""Bundle independent ScriptWidget packages, with no private account data."""
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent


def morocco_zone():
    zone = ZoneInfo("Africa/Casablanca")
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    end = datetime(2041, 1, 1, tzinfo=timezone.utc)
    offset = lambda dt: int(dt.astimezone(zone).utcoffset().total_seconds())
    initial = previous = offset(start)
    transitions = []
    cursor = start
    while cursor < end:
        current = offset(cursor)
        if current != previous:
            # Morocco transitions in the IANA dataset occur on exact hours.
            transitions.append([int(cursor.timestamp() * 1000), current])
            previous = current
        cursor += timedelta(hours=1)
    return {"start": int(start.timestamp() * 1000), "end": int(end.timestamp() * 1000),
            "initial": initial, "transitions": transitions}


def bundle(provider, zone):
    config = (ROOT / provider / "widget/config.js").read_text()
    # Build refuses accidental credentials in either source config.
    if 'const SETUP = { email: "", password: "", action: "normal" };' not in config:
        raise ValueError("Refusing to bundle changed SETUP; keep source credential-free")
    return "\n\n".join([
        config, "const MOROCCO_ZONE = " + json.dumps(zone, separators=(",", ":")) + ";",
        (ROOT / "scriptwidget/core.js").read_text(),
        (ROOT / "scriptwidget/widget.jsx").read_text(),
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=ROOT / "dist/scriptwidget",
                        help="Output directory for .swt and pasteable .jsx files (default: dist/scriptwidget)")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    zone = morocco_zone()
    for provider, name, host in [("orange", "Orange Usage", "maxit.orange.ma"), ("win", "win Usage", "api.win.ma")]:
        source = bundle(provider, zone)
        manifest = {"entry": "main.jsx", "formatVersion": 2, "id": "ma.telecom-usage." + provider,
                    "name": name, "networkDomains": [host], "permissions": ["network", "storage"],
                    "plugins": [], "runtimeVersion": "1.0", "supportedFamilies": ["systemSmall", "systemMedium", "systemLarge"],
                    "version": "1.2.2"}
        stem = provider + "-usage"
        (args.output / (stem + ".jsx")).write_text(source)
        with ZipFile(args.output / (stem + ".swt"), "w", ZIP_DEFLATED) as archive:
            archive.writestr("widget.json", json.dumps(manifest, indent=2) + "\n")
            archive.writestr("main.jsx", source)
        print(args.output / (stem + ".swt"))


if __name__ == "__main__":
    main()
