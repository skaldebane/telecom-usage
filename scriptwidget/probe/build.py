#!/usr/bin/env python3
"""Build a credential-free ScriptWidget archive from an explicit file allowlist."""
import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Destination .swt archive")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / "widget.json").read_text())
    assert manifest["entry"] == "main.jsx"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.output, "w", ZIP_DEFLATED) as archive:
        for name in ("widget.json", "main.jsx"):
            archive.write(root / name, name)
    print(args.output)


if __name__ == "__main__":
    main()
