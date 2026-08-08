#!/usr/bin/env python3
"""Collect a reproducible, browser-free DevLog-007 correctness baseline.

The harness intentionally uses only the Python standard library. It inventories
GDS fixtures directly from their record headers, captures source-level renderer
contract facts, and optionally times the existing test/check/build commands.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import struct
import subprocess
import sys
import time
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "artifacts/devlog-007/2026-08-08-correctness-foundation"

RECORD_NAMES = {
    0x0305: "UNITS",
    0x0502: "BGNSTR",
    0x0606: "STRNAME",
    0x0800: "BOUNDARY",
    0x0900: "PATH",
    0x0A00: "SREF",
    0x0B00: "AREF",
    0x0C00: "TEXT",
    0x1400: "TEXTNODE",
    0x1500: "NODE",
    0x2D00: "BOX",
}
GEOMETRY_RECORDS = ("BOUNDARY", "PATH", "SREF", "AREF", "TEXT", "BOX", "NODE", "TEXTNODE")
COMMANDS = {
    "test": ["pnpm", "exec", "vitest", "--run"],
    "check": ["pnpm", "check"],
    "build": ["pnpm", "build"],
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def gds_real8(payload: bytes) -> float:
    if len(payload) != 8 or payload == b"\0" * 8:
        return 0.0
    sign = -1.0 if payload[0] & 0x80 else 1.0
    exponent = (payload[0] & 0x7F) - 64
    mantissa = int.from_bytes(payload[1:], "big") / float(1 << 56)
    return sign * mantissa * (16.0**exponent)


def inspect_gds(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    offset = 0
    records = 0
    counts = {name: 0 for name in RECORD_NAMES.values()}
    errors: list[str] = []
    units: dict[str, float] | None = None

    while offset < len(data):
        if offset + 4 > len(data):
            errors.append(f"truncated header at byte {offset}")
            break
        record_length, tag = struct.unpack_from(">HH", data, offset)
        if record_length < 4 or record_length % 2:
            errors.append(f"invalid record length {record_length} at byte {offset}")
            break
        if offset + record_length > len(data):
            errors.append(f"record at byte {offset} exceeds file size")
            break
        records += 1
        name = RECORD_NAMES.get(tag)
        if name:
            counts[name] += 1
        if tag == 0x0305 and record_length == 20:
            payload = data[offset + 4 : offset + 20]
            dbu_in_user_units = gds_real8(payload[:8])
            meters_per_dbu = gds_real8(payload[8:])
            units = {
                "dbu_in_user_units": dbu_in_user_units,
                "meters_per_dbu": meters_per_dbu,
                "micrometers_per_dbu": meters_per_dbu * 1e6,
                "meters_per_user_unit": (
                    meters_per_dbu / dbu_in_user_units if dbu_in_user_units else math.nan
                ),
            }
        offset += record_length

    return {
        "path": str(path.relative_to(ROOT)),
        "bytes": len(data),
        "sha256": sha256(path),
        "records": records,
        "record_counts": {key: value for key, value in counts.items() if value},
        "semantic_element_records": sum(counts[key] for key in GEOMETRY_RECORDS),
        "units": units,
        "scan_errors": errors,
        "fully_scanned": offset == len(data) and not errors,
    }


def command_output(command: list[str]) -> str:
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=15,
        )
        return result.stdout.strip() or f"exit {result.returncode}"
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        return f"unavailable: {error}"


def renderer_contract_facts() -> dict[str, Any]:
    config = (ROOT / "src/lib/config.ts").read_text(encoding="utf-8")
    renderer = (ROOT / "src/lib/renderer/rendering/GDSRenderer.ts").read_text(encoding="utf-8")
    default_budget_match = re.search(
        r"VITE_MAX_POLYGONS_PER_RENDER\s*\|\|\s*([\d_]+)", config
    )
    return {
        "default_polygon_budget": (
            int(default_budget_match.group(1).replace("_", "")) if default_budget_match else None
        ),
        "budget_exhaustion_branch_present": "Budget exhausted" in renderer,
        "explicit_budget_signal_in_render_result": bool(
            re.search(r"interface RenderResult[\s\S]*?budgetExhausted", renderer)
        ),
        "explicit_depth_signal_in_render_result": bool(
            re.search(r"interface RenderResult[\s\S]*?depthLimited", renderer)
        ),
        "render_complete_log_present": "Render complete:" in renderer,
        "render_result_fields": ["totalPolygons", "renderedPolygons", "graphicsItems"],
    }


def run_timed(name: str, command: list[str], output_dir: Path) -> dict[str, Any]:
    started = time.perf_counter()
    process = subprocess.run(
        command,
        cwd=ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=os.environ.copy(),
    )
    elapsed = time.perf_counter() - started
    log_path = output_dir / f"{name}.log"
    log_path.write_text(process.stdout, encoding="utf-8")
    return {
        "command": command,
        "exit_code": process.returncode,
        "wall_seconds": round(elapsed, 3),
        "log": str(log_path.relative_to(ROOT)),
    }


def markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# DevLog-007 correctness-foundation baseline",
        "",
        f"Collected: `{report['collected_at']}`",
        f"Revision: `{report['git']['revision']}` on `{report['git']['branch']}`",
        "",
        "## Existing validation",
        "",
        "| Check | Exit | Wall time | Raw log |",
        "|---|---:|---:|---|",
    ]
    if report["commands"]:
        for name, result in report["commands"].items():
            lines.append(
                f"| {name} | {result['exit_code']} | {result['wall_seconds']:.3f} s | "
                f"`{result['log']}` |"
            )
    else:
        lines.append("| skipped | — | — | Run without `--inventory-only` |")

    lines.extend(
        [
            "",
            "## Fixture inventory",
            "",
            "Counts below come from a strict, dependency-free scan of GDS record headers; "
            "they are not expanded hierarchy counts.",
            "",
            "| Fixture | Bytes | Structures | Boundaries | Paths | SREFs | AREFs | Other elements | DBU |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for fixture in report["fixtures"]:
        counts = fixture["record_counts"]
        other = sum(counts.get(key, 0) for key in ("TEXT", "BOX", "NODE", "TEXTNODE"))
        dbu = fixture["units"]["meters_per_dbu"] if fixture["units"] else None
        lines.append(
            f"| `{fixture['path']}` | {fixture['bytes']:,} | {counts.get('BGNSTR', 0):,} | "
            f"{counts.get('BOUNDARY', 0):,} | {counts.get('PATH', 0):,} | "
            f"{counts.get('SREF', 0):,} | {counts.get('AREF', 0):,} | {other:,} | "
            f"{dbu:.6g} m |" if dbu is not None else "unknown |"
        )

    facts = report["renderer_contract"]
    lines.extend(
        [
            "",
            "## Baseline renderer contract",
            "",
            f"- Default polygon budget: `{facts['default_polygon_budget']:,}`.",
            f"- Budget-exhaustion branch present: `{str(facts['budget_exhaustion_branch_present']).lower()}`.",
            f"- Explicit budget signal in `RenderResult`: `{str(facts['explicit_budget_signal_in_render_result']).lower()}`.",
            f"- Explicit hierarchy-depth signal in `RenderResult`: `{str(facts['explicit_depth_signal_in_render_result']).lower()}`.",
            f"- `Render complete` log present: `{str(facts['render_complete_log_present']).lower()}`.",
            "",
            "These source facts make the before-state auditable without launching a browser. "
            "They are deliberately descriptive, not a substitute for later render-quality benchmarks.",
            "",
            "## Reproduce",
            "",
            "```sh",
            "python3 scripts/devlog-007/collect_baseline.py",
            "```",
            "",
            "The JSON report contains tool versions, hashes, record-scan validation, and exact commands.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--inventory-only", action="store_true", help="Skip test, check, and build commands"
    )
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    fixture_paths = sorted((ROOT / "tests/gds").glob("*.gds"))
    report: dict[str, Any] = {
        "schema_version": 1,
        "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "git": {
            "revision": command_output(["git", "rev-parse", "HEAD"]),
            "branch": command_output(["git", "branch", "--show-current"]),
        },
        "environment": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "node": command_output(["node", "--version"]),
            "pnpm": command_output(["pnpm", "--version"]),
        },
        "fixtures": [inspect_gds(path) for path in fixture_paths],
        "renderer_contract": renderer_contract_facts(),
        "commands": {},
    }
    if not args.inventory_only:
        for name, command in COMMANDS.items():
            report["commands"][name] = run_timed(name, command, output_dir)

    json_path = output_dir / "baseline.json"
    markdown_path = output_dir / "baseline.md"
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    markdown_path.write_text(markdown_report(report), encoding="utf-8")
    print(markdown_path.relative_to(ROOT))
    print(json_path.relative_to(ROOT))
    return 0 if all(result["exit_code"] == 0 for result in report["commands"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
