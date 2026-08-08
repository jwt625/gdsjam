#!/usr/bin/env python3
"""Generate the small, deterministic DevLog-007 GDS correctness fixtures.

The generated GDS files and semantic JSON are committed so the web test suite
does not require Python or gdstk.  gdstk is used only as the independent writer
and reference reader for fixture generation.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import gdstk


REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "tests" / "fixtures" / "devlog-007"
FIXED_TIMESTAMP = datetime(2025, 1, 1, 0, 0, 0)
SCHEMA_VERSION = 1


def _new_library(name: str, *, precision: float = 1e-9) -> gdstk.Library:
    return gdstk.Library(name=name, unit=1e-6, precision=precision)


def non_default_dbu() -> tuple[gdstk.Library, str]:
    library = _new_library("NON_DEFAULT_DBU", precision=5e-9)
    top = library.new_cell("TOP_NON_DEFAULT_DBU")
    top.add(gdstk.rectangle((1.25, -0.5), (3.75, 2.0), layer=1, datatype=7))
    top.add(gdstk.Polygon([(5.0, 0.0), (6.0, 0.0), (5.5, 1.5)], layer=2))
    return library, "5 nm database unit with geometry on two layer/datatype pairs"


def transformed_sref() -> tuple[gdstk.Library, str]:
    library = _new_library("TRANSFORMED_SREF")
    leaf = library.new_cell("ASYMMETRIC_LEAF")
    leaf.add(gdstk.Polygon([(0, 0), (4, 0), (4, 1), (1, 1), (1, 3), (0, 3)], layer=10))

    top = library.new_cell("TOP_TRANSFORMED_SREF")
    top.add(
        gdstk.Reference(
            leaf,
            origin=(20, 10),
            rotation=math.pi / 2,
            magnification=2,
            x_reflection=True,
        )
    )
    top.add(gdstk.Reference(leaf, origin=(-8, 4), rotation=math.pi, magnification=0.5))
    return library, "asymmetric leaf under rotated, reflected, and magnified SREF transforms"


def skewed_aref() -> tuple[gdstk.Library, str]:
    library = _new_library("SKEWED_AREF")
    leaf = library.new_cell("ARRAY_LEAF")
    leaf.add(gdstk.rectangle((0, 0), (2, 1), layer=20, datatype=3))

    top = library.new_cell("TOP_SKEWED_AREF")
    # A rotated rectangular repetition is encoded as one GDS AREF whose two
    # lattice vectors both have non-zero X/Y components.  The chosen angle and
    # pitch produce exact vectors v1=(7, 3) and v2=(-3, 7) in user units.
    array = gdstk.Reference(
        leaf,
        origin=(10, 20),
        rotation=math.atan2(3, 7),
        columns=3,
        rows=2,
        spacing=(math.sqrt(58), math.sqrt(58)),
    )
    top.add(array)
    return library, "3 by 2 rotated AREF with lattice vectors (7, 3) and (-3, 7) um"


def multiple_top_cells() -> tuple[gdstk.Library, str]:
    library = _new_library("MULTIPLE_TOP_CELLS")
    shared = library.new_cell("SHARED_CHILD")
    shared.add(gdstk.rectangle((0, 0), (2, 2), layer=30))

    top_a = library.new_cell("TOP_A")
    top_a.add(gdstk.Reference(shared, origin=(-10, 0)))
    top_a.add(gdstk.rectangle((-12, -2), (-8, -1), layer=31))

    top_b = library.new_cell("TOP_B")
    top_b.add(gdstk.Reference(shared, origin=(25, 8), rotation=math.pi / 2))
    top_b.add(gdstk.rectangle((24, 5), (28, 6), layer=32))
    return library, "two independent top cells sharing one referenced child"


FIXTURES: dict[str, Callable[[], tuple[gdstk.Library, str]]] = {
    "multiple_top_cells": multiple_top_cells,
    "non_default_dbu": non_default_dbu,
    "skewed_aref": skewed_aref,
    "transformed_sref": transformed_sref,
}


def _number(value: float) -> int | float:
    rounded = round(float(value), 12)
    integer = round(rounded)
    return integer if abs(rounded - integer) < 1e-9 else rounded


def _point_um(point: Any) -> list[int | float]:
    return [_number(point[0]), _number(point[1])]


def _point_dbu(point: Any, database_unit_meters: float) -> list[int | float]:
    user_units_per_dbu = database_unit_meters / 1e-6
    return [_number(point[0] / user_units_per_dbu), _number(point[1] / user_units_per_dbu)]


def _canonical_ring(points: Any) -> list[list[int | float]]:
    ring = [_point_um(point) for point in points]
    candidates = []
    for direction in (ring, list(reversed(ring))):
        for index in range(len(direction)):
            candidates.append(direction[index:] + direction[:index])
    return min(candidates)


def _bounds(polygons: list[dict[str, Any]], unit_key: str) -> dict[str, int | float] | None:
    if not polygons:
        return None
    points = [point for polygon in polygons for point in polygon[unit_key]]
    return {
        "minX": min(point[0] for point in points),
        "minY": min(point[1] for point in points),
        "maxX": max(point[0] for point in points),
        "maxY": max(point[1] for point in points),
    }


def _polygon_record(polygon: gdstk.Polygon, database_unit_meters: float) -> dict[str, Any]:
    points_um = _canonical_ring(polygon.points)
    points_dbu = [_point_dbu(point, database_unit_meters) for point in points_um]
    return {
        "layer": polygon.layer,
        "datatype": polygon.datatype,
        "pointsDbu": points_dbu,
        "pointsUm": points_um,
    }


def _sort_polygons(polygons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        polygons,
        key=lambda polygon: (
            polygon["layer"],
            polygon["datatype"],
            json.dumps(polygon["pointsDbu"], separators=(",", ":")),
        ),
    )


def _reference_record(reference: gdstk.Reference, database_unit_meters: float) -> dict[str, Any]:
    record: dict[str, Any] = {
        "cell": reference.cell_name,
        "originDbu": _point_dbu(reference.origin, database_unit_meters),
        "originUm": _point_um(reference.origin),
        "rotationDegrees": _number(math.degrees(reference.rotation)),
        "xReflection": reference.x_reflection,
        "magnification": _number(reference.magnification),
    }
    repetition = reference.repetition
    if repetition is not None and repetition.columns is not None and repetition.rows is not None:
        record["array"] = {
            "columns": repetition.columns,
            "rows": repetition.rows,
            "v1Dbu": _point_dbu(repetition.v1, database_unit_meters),
            "v1Um": _point_um(repetition.v1),
            "v2Dbu": _point_dbu(repetition.v2, database_unit_meters),
            "v2Um": _point_um(repetition.v2),
            "offsetsDbu": [
                _point_dbu(offset, database_unit_meters) for offset in repetition.get_offsets()
            ],
        }
    return record


def _semantic_oracle(gds_path: Path, fixture_name: str, description: str) -> dict[str, Any]:
    library = gdstk.read_gds(gds_path)
    database_unit_meters = library.precision
    top_cells = sorted(library.top_level(), key=lambda cell: cell.name)

    cells = []
    for cell in sorted(library.cells, key=lambda item: item.name):
        local_polygons = _sort_polygons(
            [_polygon_record(polygon, database_unit_meters) for polygon in cell.polygons]
        )
        references = sorted(
            [_reference_record(reference, database_unit_meters) for reference in cell.references],
            key=lambda item: (item["cell"], item["originDbu"]),
        )
        cells.append(
            {
                "name": cell.name,
                "localPolygons": local_polygons,
                "references": references,
            }
        )

    flattened_top_cells = []
    all_top_polygons: list[dict[str, Any]] = []
    for cell in top_cells:
        polygons = _sort_polygons(
            [_polygon_record(polygon, database_unit_meters) for polygon in cell.get_polygons()]
        )
        all_top_polygons.extend(polygons)
        flattened_top_cells.append(
            {
                "name": cell.name,
                "polygonCount": len(polygons),
                "boundsDbu": _bounds(polygons, "pointsDbu"),
                "boundsUm": _bounds(polygons, "pointsUm"),
                "polygons": polygons,
            }
        )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "fixture": fixture_name,
        "description": description,
        "units": {
            "userUnitMeters": library.unit,
            "databaseUnitMeters": database_unit_meters,
            "databaseUnitsPerUserUnit": _number(library.unit / database_unit_meters),
            "displayUnit": "um",
        },
        "topCells": [cell.name for cell in top_cells],
        "documentBoundsDbu": _bounds(all_top_polygons, "pointsDbu"),
        "documentBoundsUm": _bounds(all_top_polygons, "pointsUm"),
        "cells": cells,
        "flattenedTopCells": flattened_top_cells,
    }


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_entries = []

    for fixture_name, factory in sorted(FIXTURES.items()):
        library, description = factory()
        gds_path = OUTPUT_DIR / f"{fixture_name}.gds"
        oracle_path = OUTPUT_DIR / f"{fixture_name}.semantic.json"
        library.write_gds(gds_path, timestamp=FIXED_TIMESTAMP)
        _write_json(oracle_path, _semantic_oracle(gds_path, fixture_name, description))

        gds_bytes = gds_path.read_bytes()
        oracle_bytes = oracle_path.read_bytes()
        manifest_entries.append(
            {
                "name": fixture_name,
                "description": description,
                "gds": {
                    "file": gds_path.name,
                    "bytes": len(gds_bytes),
                    "sha256": hashlib.sha256(gds_bytes).hexdigest(),
                },
                "oracle": {
                    "file": oracle_path.name,
                    "bytes": len(oracle_bytes),
                    "sha256": hashlib.sha256(oracle_bytes).hexdigest(),
                },
            }
        )

    _write_json(
        OUTPUT_DIR / "manifest.json",
        {
            "schemaVersion": SCHEMA_VERSION,
            "generator": "scripts/devlog-007/generate_fixtures.py",
            "gdstkVersion": gdstk.__version__,
            "fixtures": manifest_entries,
        },
    )


if __name__ == "__main__":
    main()
