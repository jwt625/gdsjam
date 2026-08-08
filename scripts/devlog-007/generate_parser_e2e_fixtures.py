#!/usr/bin/env python3
"""Generate small malformed-UNITS GDS fixtures for browser diagnostics tests.

This intentionally uses only Python's standard library. gdstk normalizes library
units when writing, so it cannot preserve the missing/invalid declarations these
negative-path fixtures need to exercise.
"""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "devlog-007" / "parser-diagnostics"

HEADER = 0x0002
BGNLIB = 0x0102
LIBNAME = 0x0206
UNITS = 0x0305
ENDLIB = 0x0400
BGNSTR = 0x0502
STRNAME = 0x0606
ENDSTR = 0x0700
TEXT = 0x0C00
LAYER = 0x0D02
XY = 0x1003
ENDEL = 0x1100
TEXTTYPE = 0x1602
STRING = 0x1906
BOX = 0x2D00
BOXTYPE = 0x2E02


def record(tag: int, payload: bytes = b"") -> bytes:
    if len(payload) % 2:
        raise ValueError(f"record 0x{tag:04x} has odd payload length")
    return struct.pack(">HH", len(payload) + 4, tag) + payload


def int16(value: int) -> bytes:
    return struct.pack(">h", value)


def string(value: str) -> bytes:
    payload = value.encode("ascii")
    return payload if len(payload) % 2 == 0 else payload + b"\0"


def xy(points: list[tuple[int, int]]) -> bytes:
    return b"".join(struct.pack(">ii", x, y) for x, y in points)


def timestamps() -> bytes:
    # Two deterministic six-word timestamps: 2026-08-08 00:00:00.
    stamp = struct.pack(">6H", 2026, 8, 8, 0, 0, 0)
    return stamp + stamp


def semantic_cell() -> bytes:
    return b"".join(
        [
            record(BGNSTR, timestamps()),
            record(STRNAME, string("TOP")),
            record(BOX),
            record(LAYER, int16(7)),
            record(BOXTYPE, int16(3)),
            record(XY, xy([(0, 0), (20, 0), (20, 10), (0, 10), (0, 0)])),
            record(ENDEL),
            record(TEXT),
            record(LAYER, int16(12)),
            record(TEXTTYPE, int16(4)),
            record(XY, xy([(100, -50)])),
            record(STRING, string("device-A")),
            record(ENDEL),
            record(ENDSTR),
        ]
    )


def library(units: bytes | None) -> bytes:
    records = [
        record(HEADER, int16(600)),
        record(BGNLIB, timestamps()),
        record(LIBNAME, string("PARSER_DIAGNOSTICS")),
    ]
    if units is not None:
        records.append(record(UNITS, units))
    records.extend([semantic_cell(), record(ENDLIB)])
    return b"".join(records)


def main() -> None:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    fixtures = {
        "missing_units.gds": library(None),
        # A zero GDS real is eight zero bytes. Both declared values are invalid.
        "invalid_units.gds": library(b"\0" * 16),
    }
    manifest: dict[str, object] = {
        "generator": "scripts/devlog-007/generate_parser_e2e_fixtures.py",
        "fixtures": {},
    }
    fixture_metadata = manifest["fixtures"]
    assert isinstance(fixture_metadata, dict)
    for name, content in fixtures.items():
        path = FIXTURE_DIR / name
        path.write_bytes(content)
        fixture_metadata[name] = {
            "bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
    (FIXTURE_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
