# Parser diagnostics browser-E2E validation — 2026-08-08

Branch: `feature/devlog-007-parser-e2e`

Base during implementation: `da39c45` (`feature/devlog-007-integration`). The
integration branch advanced during validation; this milestone is intentionally
one clean commit for rebasing by the orchestrator.

## Scope

- Reproducible binary fixtures for missing and zero-valued GDS `UNITS` records.
- Browser-level proof that both cases remain usable but visibly report
  `partial-malformed` and the provisional 1 nm DBU scale.
- E2E semantic digest coverage for BOX geometry provenance and TEXT
  origin-marker semantics. This does not claim TEXT glyph rendering.
- Desktop Chromium and emulated iPad coverage with captured browser-console
  errors required to remain empty.

## Fixture evidence

The standard-library generator was run twice with identical output:

| Fixture | Bytes | SHA-256 |
| --- | ---: | --- |
| `invalid_units.gds` | 228 | `cf3f281e2130c460ab41c29aaecbd0f4be816385869b21eed7dbe329168cacde` |
| `missing_units.gds` | 208 | `5bbb57d2b590160f89a05e4f8a9ccdd8effaacb2f31c802effdbfeb3ea0ee722` |

gdstk is not used for these two negative fixtures because its writer emits a
normalized valid unit declaration. The generator emits complete deterministic
GDS records directly and documents that exception next to the fixtures.

## Validation evidence

| Command | Result |
| --- | --- |
| `pnpm exec vitest --run` | 21 files, 150 tests passed; 1.02 s Vitest duration |
| `pnpm check` | Svelte/TypeScript checks passed; 0 errors, 0 warnings |
| `pnpm build` | 2,213 modules transformed; production build passed in 11.53 s |
| `pnpm test:e2e` | 10 tests passed across desktop Chromium and emulated iPad in 7.3 s |
| `pnpm test:production-api` | Production build passed; 103 emitted assets contained no E2E API markers |
| `pnpm exec biome check src/lib/testing/e2eTestApi.ts e2e/parser-diagnostics.spec.ts` | Passed with no fixes |
| `git diff --check` | Passed |

The full Vitest run emitted only expected stderr from existing negative-path
tests and the deliberate cyclic-reference fixture. Production builds retain the
existing large-chunk warning. Playwright emitted Node color-environment warnings;
all application browser consoles had zero captured errors.
