# Parser diagnostics browser fixtures

These synthetic GDS streams exercise recoverable library-unit failures while
preserving usable semantic content:

- `missing_units.gds` omits the library `UNITS` record.
- `invalid_units.gds` declares both GDS real values as zero.

Both fixtures contain a BOX on layer 7 / boxtype 3 and a TEXT marker named
`device-A` on layer 12 / texttype 4. TEXT is asserted as an origin marker; these
tests do not claim font-independent glyph rendering.

Regenerate deterministically with:

```sh
python3 scripts/devlog-007/generate_parser_e2e_fixtures.py
```

The generator uses only the Python standard library because gdstk writes a
normalized valid `UNITS` record and therefore cannot author these negative-path
fixtures directly.
