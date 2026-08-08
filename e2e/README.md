# Browser correctness tests

Install Chromium once with `pnpm test:e2e:install`, then run `pnpm test:e2e`.
The Playwright server sets `VITE_E2E=true` and injects committed synthetic GDS
bytes through `window.__GDSJAM_TEST__`; it does not use the upload dialog or
network-hosted layouts. Tests synchronize on the API's render-idle state and
`gdsjam:e2e-lifecycle` events rather than fixed delays.

Desktop Chromium and Chromium with an emulated iPad viewport are exercised.
Trace, screenshot, video, and browser-console artifacts are retained on
failure under ignored Playwright output directories.

The test API must not ship. `pnpm test:production-api` builds without the E2E
flag and fails if any test-API marker is present in emitted HTML, JavaScript,
or CSS.
