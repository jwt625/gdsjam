# DevLog-007-01: End-to-End Validation and Collaboration Testing Roadmap

**Date**: 2026-08-05  
**Status**: Proposed  
**Scope**: Define a closed-loop validation system for layout-rendering correctness, interactive viewer behavior, performance, multiplayer collaboration, WebRTC/TURN reliability, mobile compatibility, and production confidence.

## Decision Summary

GDSJam needs a layered validation system rather than a single end-to-end test suite. The recommended stack is:

```text
Geometry and parser oracles
        ↓
Deterministic renderer tests
        ↓
Playwright interaction and multi-user tests
        ↓
Per-PR preview deployment
        ↓
Nightly network-chaos and real-device tests
        ↓
Production collaboration canary
        ↓
Trace, screenshot, and metrics artifacts for human or LLM triage
```

The key separation is:

- **Deterministic tools decide correctness**: geometry, transforms, layer coverage, state convergence, and protocol assertions.
- **Browser automation validates behavior**: controls, navigation, responsive UI, and collaborative workflows.
- **Real devices validate platform reality**: Mobile Safari, touch behavior, WebGL performance, memory pressure, and network conditions.
- **LLMs assist exploration and triage**: they may identify suspicious visual or workflow behavior, but must not approve geometric correctness or automatically update baselines.

This document complements [DevLog-007-00](DevLog-007-00-Semantic-Chipmap-and-EDA-Analysis-Roadmap.md), whose renderer roadmap requires a trusted correctness and performance harness before architectural changes proceed.

## Motivation

### Current Development Loop

The current validation loop depends heavily on manual inspection:

1. Load a representative GDSII file.
2. Pan and zoom across the design.
3. Inspect rendering correctness and responsiveness.
4. Exercise panels, controls, measurements, and comments.
5. Deploy a branch to a reachable environment.
6. Join from a development machine, phone, and iPad.
7. Manually verify WebRTC connection, file state, viewport sync, layers, and comments.

This process is valuable for exploratory testing but has several limitations:

- Results are difficult to reproduce precisely.
- Visual failures may not identify whether the parser, transform, renderer, or UI is responsible.
- Collaboration testing requires deployment and multiple physical devices.
- Direct and TURN-relayed WebRTC paths are not explicitly distinguished.
- Performance feedback is subjective and lacks stable budgets.
- Manual findings do not automatically become regression tests.

### Existing Automated Coverage

The repository currently includes Vitest coverage for selected renderer logic, collaboration helpers, API authentication, TURN credential handling, and server middleware. CI performs lint, type checking, unit tests, and build verification.

Important missing layers are:

- Parser-to-renderer integration tests.
- Deterministic canvas or WebGL rendering comparisons.
- Real browser interaction tests.
- Multi-user browser tests using actual Y.js/WebRTC connections.
- Forced-TURN and selected-ICE-candidate assertions.
- Fault-injection and reconnection tests.
- Per-PR preview deployments.
- Real iPhone and iPad automation.
- Production collaboration canaries.

## Validation Principles

1. **Use the narrowest reliable oracle**: assert geometry numerically before relying on screenshots.
2. **Assert state, not timing guesses**: wait for explicit readiness, idle, connection, and convergence events.
3. **Test eventual convergence**: collaborative tests should not depend on a specific message ordering.
4. **Keep failures replayable**: every failure should include the seed, actions, environment, and diagnostic artifacts.
5. **Separate correctness from performance**: a fast incomplete render and a correct slow render are different failures.
6. **Separate deterministic and noisy environments**: use pinned CI for hard budgets and real-device/cloud runs for trend detection.
7. **Test the transport actually used**: success alone does not prove that TURN fallback was exercised.
8. **Preserve manual exploration**: automation should shorten manual testing and capture its output, not claim to eliminate it.
9. **Protect design data**: fixtures and diagnostic bundles must avoid uploading proprietary layouts by default.
10. **Convert regressions into permanent fixtures**: every confirmed rendering or collaboration bug should add a minimal test case.

## Proposed Test Architecture

### 1. Vitest Unit and Property Tests

Continue using Vitest for fast, deterministic modules:

- GDSII record decoding.
- Path-to-polygon conversion.
- Affine-transform composition.
- AREF lattice calculations.
- Cell bounds and reference topology.
- LOD and representation selection.
- Tile-coordinate calculations and cache invalidation.
- Collaboration stores and conflict rules.
- Token, file, signaling, and TURN credential clients.

Add property and metamorphic tests where exact expected geometry is cumbersome:

- Translating the complete design translates every bound by the same vector.
- Reordering GDSII cells or polygons does not change the rendered semantic digest.
- Pan away and return restores the same render digest.
- Zoom in and return to the same zoom restores the same coverage.
- Mirroring twice yields the original geometry.
- Rotation composition agrees with a canonical affine matrix.
- Hiding and restoring a layer returns the prior complete state.

### 2. Reference Geometry Fixtures

Maintain generated, reviewable fixtures with known expected behavior:

| Fixture | Primary purpose |
|---|---|
| Flat Manhattan layout | Polygon density, sampling, and layer compositing |
| Deep hierarchy | Recursive bounds, traversal, and transform composition |
| Rotated and mirrored SREF | Affine correctness |
| Skewed AREF lattice | Preservation of both array vectors |
| Repeated photonic cell array | Hierarchy-cache and instancing behavior |
| PATH-heavy photonic layout | Thin geometry and path conversion |
| Multiple top cells | Top-cell selection and complete overview |
| Non-default DBU | Unit consistency |
| Unsupported or damaged records | Diagnostics and graceful partial failure |
| Large mixed design | Interaction latency, memory, and cancellation |

Generate fixtures through gdstk, gdsfactory, or a minimal binary fixture builder. Store the generation source next to each binary fixture so the expected geometry remains inspectable and reproducible.

### 3. Semantic Geometry Oracle

For each fixture, commit expected values generated by a trusted reference implementation such as gdstk or KLayout:

- Cell and top-cell names.
- Cell graph and reference counts.
- Layer and datatype counts.
- Cell and layout bounds.
- Representative transformed vertices.
- AREF instance positions or compact lattice definitions.
- Per-layer polygon area or coverage.
- Unsupported and unresolved element counts.

The semantic oracle should run before visual comparisons. It is faster and identifies incorrect transforms that may still look plausible in a screenshot.

### 4. Reference Raster Oracle

For fixed fixture, viewport, layer set, and zoom combinations:

1. Render a reference crop using KLayout or a deliberately slow coverage-aware rasterizer.
2. Set GDSJam to the identical world viewport.
3. Wait for the application to report a complete and idle render.
4. Capture the canvas and per-layer masks when available.
5. Compare missing coverage, false coverage, seam pixels, RMS error, and SSIM.

Per-layer masks are preferred over only comparing final RGB output because they distinguish missing geometry from layer color or compositing differences.

Golden images must be generated and compared in a pinned environment. Browser, operating system, fonts, device-pixel ratio, GPU backend, and headless mode must remain stable for blocking pixel comparisons.

### 5. Playwright Browser E2E

Adopt Playwright for browser-level testing across Chromium, Firefox, and WebKit. Use Playwright projects for desktop, mobile, and tablet profiles.

Proposed structure:

```text
e2e/
  fixtures/
  helpers/
    collaboration.ts
    gdsjam-test-api.ts
    render-assertions.ts
  viewer/
    load-and-navigate.spec.ts
    controls.spec.ts
    measurements.spec.ts
    mobile-layout.spec.ts
    rendering-goldens.spec.ts
  collaboration/
    host-and-join.spec.ts
    viewport-sync.spec.ts
    layers-and-comments.spec.ts
    reconnect-and-migration.spec.ts
    forced-turn.spec.ts
  performance/
    layout-tour.spec.ts
```

Every failed test should retain:

- Playwright trace.
- Screenshot and visual diff.
- Video where useful.
- Console output.
- Relevant network and WebSocket events.
- Application render and collaboration diagnostics.

## Testability Contract

### Test-Only Application API

Canvas and WebGL applications are unreliable to test using pointer coordinates alone. Add a test API enabled only in development and E2E builds:

```ts
interface GDSJamTestAPI {
	loadFixture(name: string): Promise<void>;
	setViewport(viewport: TestViewport): Promise<void>;
	waitForRenderIdle(): Promise<void>;
	getViewport(): TestViewport;
	getRenderMetrics(): RenderTestMetrics;
	getRenderDigest(): RenderDigest;
	getCollaborationState(): CollaborationTestState;
	getIceStats(): Promise<IceTestStats>;
}

declare global {
	interface Window {
		__GDSJAM_TEST__?: GDSJamTestAPI;
	}
}
```

The API is for deterministic setup, synchronization, and diagnostics. Tests should still use real UI controls for user-facing behavior.

### Explicit Lifecycle Events

Emit stable events rather than relying on arbitrary delays:

```text
gdsjam:file-parsed
gdsjam:overview-ready
gdsjam:render-idle
gdsjam:collaboration-connected
gdsjam:collaboration-converged
```

### Render Digest

The render digest should include:

- Document and revision hash.
- World viewport and device-pixel ratio.
- Render completeness and representation level.
- Per-layer visible geometry or coverage counts.
- Unsupported, unresolved, or truncated geometry.
- Tile or hierarchy-cache revision where applicable.

This permits semantic assertions even when cross-browser GPU output differs slightly.

## Interactive Layout-Browsing Tests

### Scripted Layout Tour

For each representative layout:

1. Load the fixture.
2. Fit to view.
3. Capture the complete overview.
4. Pan to fixed world anchors.
5. Zoom across representation or LOD boundaries.
6. Toggle representative layers.
7. Switch fill and outline modes.
8. Create a measurement over known geometry.
9. Open, move, collapse, and close relevant panels.
10. Resize across desktop, tablet, and mobile breakpoints.
11. Return to the original viewport.
12. Compare the final digest and screenshot with the initial state.

### Interaction Assertions

- Zoom remains centered on the requested cursor or touch point.
- Pan direction and distance are consistent with the coordinate system.
- Fit-to-view includes the complete document bounds.
- Layer toggles do not corrupt unrelated layers.
- Measurements remain anchored during pan and zoom.
- Panels remain visible and usable at supported breakpoints.
- No blank frame persists after a viewport change.
- No console errors or unhandled promise rejections occur.

### Performance Measurements

Capture:

- Parse wall time.
- Time to first complete overview.
- Time to first sharp or exact viewport.
- Pan and zoom frame-time p50, p95, and p99.
- Longest main-thread task.
- Blank-frame count.
- Stale-render cancellation and commit counts.
- CPU and GPU cache hit rates.
- Peak geometry, tile, and texture memory where observable.

Hard performance budgets should run on a pinned runner. Cloud and real-device tests should initially track trends because shared hardware introduces noise.

## Multiplayer and Collaboration Testing

### Multi-Context Test Model

A Playwright test should create independent browser contexts for each participant:

```text
Host: desktop Chromium
Viewer A: phone profile
Viewer B: tablet profile or second desktop browser
```

Each test uses a unique room namespace:

```text
e2e-{gitSha}-{workerIndex}-{randomId}
```

Use explicit barriers:

```text
host ready
→ viewer joins
→ document hashes converge
→ action is performed
→ all expected participants converge
→ state digests are asserted
```

Tests must assert eventual state and avoid depending on exact CRDT message ordering.

### Blocking Collaboration Scenarios

- [ ] Host creates a session and viewer joins.
- [ ] File metadata and document hashes converge.
- [ ] Viewer follows and stops following the host viewport.
- [ ] Layer broadcast and follow modes behave correctly.
- [ ] Root comments and threaded replies converge.
- [ ] Comment permissions propagate.
- [ ] Viewer leaves and rejoins.
- [ ] Late join receives current file, layer, comment, and host state.
- [ ] Host reloads or replaces the design.
- [ ] Independent sessions do not leak state.

### Nightly Collaboration Scenarios

- [ ] Three or more simultaneous participants.
- [ ] Host migration after graceful departure.
- [ ] Host loss without graceful departure.
- [ ] Concurrent comments, replies, and layer changes.
- [ ] Browser refresh during synchronization.
- [ ] Signaling interruption and recovery.
- [ ] File/API server timeout, 500 response, and restart.
- [ ] Token expiry during a session.
- [ ] Offline and online transition.
- [ ] Large-file metadata and download synchronization.
- [ ] Direct WebRTC path.
- [ ] Forced TURN relay path.

### TURN Verification

Add a test-only configuration that sets:

```ts
iceTransportPolicy: "relay"
```

After connection, inspect `RTCPeerConnection.getStats()` and assert:

- Selected local or remote candidate type is `relay`.
- The candidate pair is nominated and connected.
- Data-channel messages and bytes increase after a synchronization action.
- Round-trip time remains within a diagnostic threshold.

A successful session does not prove TURN was used. Candidate and transport statistics must confirm the selected path.

## Local Collaboration Test Environment

Provide a reproducible test topology using Docker Compose or equivalent orchestration:

```text
frontend
signaling and API server
coturn
toxiproxy
```

The environment should support:

- Ephemeral test credentials.
- Unique room namespaces.
- Fast reset and cleanup.
- Direct and relay-only ICE configurations.
- Service restart during tests.
- Collected server and coturn logs.
- No dependency on production services.

### Fault Injection

Use the narrowest suitable mechanism:

| Mechanism | Intended faults |
|---|---|
| Playwright request routing | REST errors, timeouts, and malformed responses |
| Playwright WebSocket routing | Signaling disconnects and message faults |
| Toxiproxy | TCP/WebSocket latency, bandwidth, timeout, and reset |
| Chrome DevTools Protocol | WebRTC packet loss, queueing, and reordering |
| Linux `tc netem` | Deep UDP/TCP delay, loss, duplication, corruption, and reorder |

Use seeded network-fault configurations so failures can be reproduced.

## Preview Deployments

### Per-PR Frontend Preview

Every pull request should receive an HTTPS preview URL accessible from:

- Developer machines.
- Phones and tablets.
- Playwright CI.
- Real-device cloud providers.

Recommended topology:

```text
PR frontend preview
        ↓
shared staging signaling/API/TURN environment
        ↓
test room namespace isolated by PR and run
```

A shared staging collaboration backend is initially preferable to deploying coturn per branch. It must have:

- Explicit preview-origin handling.
- Separate staging credentials.
- Short fixture and room retention.
- Test namespace isolation.
- No proprietary production design data.
- Accessible diagnostic logs.

Candidate preview platforms include Cloudflare Pages and Vercel. The preview URL should be attached to the pull request and passed automatically to E2E jobs.

## Cross-Browser and Real-Device Matrix

### Pull Request Matrix

- Chromium desktop.
- Firefox desktop.
- WebKit desktop.
- Emulated phone viewport and touch profile.
- Emulated tablet viewport and touch profile.

### Nightly or Pre-Release Matrix

- Real iPhone Safari.
- Real iPad Safari.
- Real Android Chrome.
- One two-real-device collaborative session.
- One forced-TURN session under slow or lossy networking.
- Portrait and landscape orientation for high-risk viewer workflows.

Browser emulation is appropriate for responsive layout and basic touch-enabled behavior. It is not a substitute for real Mobile Safari rendering, WebGL behavior, memory limits, browser chrome, elastic scrolling, or device networking.

## LLM-Assisted Validation

### Appropriate Uses

- Explore the application from a natural-language workflow goal.
- Identify blank canvases, clipped panels, overlapping controls, unreadable labels, and suspicious discontinuities.
- Review current, baseline, and diff screenshots together.
- Summarize Playwright traces, console output, ICE stats, and performance metrics.
- Cluster similar failures across browser and device runs.
- Convert a confirmed manual failure into a candidate Playwright scenario.
- Generate scenario permutations from requirements and DevLogs.

### Inappropriate Uses

- Deciding whether transformed GDSII geometry is correct.
- Approving small layer, spacing, or via differences.
- Replacing explicit readiness and convergence conditions.
- Updating golden images automatically.
- Hiding broken selectors through unreviewed self-healing.
- Serving as the only merge gate for rendering or collaboration behavior.

### Required Evidence Bundle

An LLM reviewer should receive:

```text
baseline screenshot
current screenshot
visual diff
semantic render digest
performance metrics
console and network errors
collaboration and ICE state
Playwright trace summary
test seed and exact action sequence
```

Initially, LLM review is advisory and non-blocking. A useful result must identify evidence and produce a replayable scenario rather than only stating that a screen looks wrong.

## Manual Feedback Capture

Add a privacy-conscious **Download Diagnostics** action containing:

- Application and git version.
- Browser, operating system, viewport, and DPR.
- File hash and size, not file contents.
- Current viewport and layer state.
- Recent high-level action history.
- Render metrics and completeness state.
- Collaboration participants and connection state.
- Selected ICE candidate type and RTT.
- Console errors.
- Optional screenshot.

Example action history:

```json
[
	{ "action": "fitToView" },
	{ "action": "zoom", "center": [412, 288], "factor": 2 },
	{ "action": "toggleLayer", "layer": "31:0", "visible": false }
]
```

The diagnostic bundle should be sufficient to reproduce most interaction failures without including proprietary geometry. File upload is opt-in and separate.

## CI Execution Tiers

### Tier 0: Pre-Commit

- Formatting and linting for changed source files.
- Fast unit tests for directly affected modules when practical.

Target duration: under 30 seconds.

### Tier 1: Pull Request Blocking

- Full lint, type check, unit tests, and build.
- Parser and semantic fixture suite.
- Chromium viewer smoke suite.
- Two-user collaboration smoke suite.
- Deterministic renderer screenshots on pinned Linux/Chromium.
- Trace and screenshot artifacts on failure.

Target duration: under 10 minutes.

### Tier 2: Pull Request Extended

- Firefox and WebKit viewer tests.
- Emulated phone and tablet projects.
- Performance layout tour.
- Selected three-user and reconnect tests.

These may run in parallel and may initially be non-blocking while flakiness is removed.

### Tier 3: Nightly

- Complete collaboration scenario matrix.
- Network and service fault injection.
- Forced TURN relay validation.
- Large fixture and memory tests.
- Real iPhone, iPad, and Android tests.
- LLM-assisted visual and trace review.

### Tier 4: Production Canary

Run a small, non-proprietary synthetic collaboration session periodically:

1. Two agents join a unique production test room.
2. Load a tiny public fixture.
3. Synchronize viewport, layer state, and a disposable comment.
4. Verify convergence and selected ICE path.
5. Clean up the test room and artifact.

Alert on repeated failure rather than a single transient failure.

## Success Metrics

### Rendering

- No incomplete render is reported as complete.
- Fixed-view semantic digests are deterministic.
- Reference coverage and image error remain within defined thresholds.
- No persistent blank viewport during scripted tours.
- No tile or cell seams above the accepted threshold.

### Interaction

- Core mouse, keyboard, and touch workflows pass on the supported matrix.
- Panel and viewer layouts do not clip at supported breakpoints.
- Performance p95 remains within fixture-specific budgets.
- No unhandled browser errors occur during core journeys.

### Collaboration

- State converges for all blocking scenarios within defined timeouts.
- Direct and forced-relay WebRTC paths are independently verified.
- Reconnect and late-join behavior are deterministic.
- Test rooms remain isolated.
- Failures retain sufficient artifacts for local reproduction.

### Development Loop

- Every pull request has a reachable preview URL.
- A developer can run the two-user collaboration suite locally with one command.
- A confirmed manual regression can be converted into an automated fixture without deployment-specific setup.
- Manual device testing is reduced to targeted exploratory validation rather than full regression repetition.

## Implementation Roadmap

### Phase 0: Testability Contract

- [ ] Add Playwright and browser projects.
- [ ] Add the test-only application API.
- [ ] Emit explicit render and collaboration lifecycle events.
- [ ] Add stable role- or test-ID-based locators to critical controls.
- [ ] Configure trace, screenshot, video, and console artifacts.
- [ ] Add one desktop and one emulated-mobile smoke test.

**Exit criteria**:

- A test can load a fixture, set an exact viewport, wait for idle, and retrieve a render digest without arbitrary sleeps.

### Phase 1: Viewer and Renderer Validation

- [ ] Add the generated fixture corpus.
- [ ] Add semantic reference outputs.
- [ ] Add fixed-viewport renderer screenshots.
- [ ] Add scripted layout tours.
- [ ] Add initial performance metrics and budgets.
- [ ] Add console and unhandled-error gating.

**Exit criteria**:

- Common rendering, control, and responsive-layout regressions fail deterministically in CI.

### Phase 2: Collaboration Harness

- [ ] Add multi-context host and viewer helpers.
- [ ] Add unique room namespaces and cleanup.
- [ ] Add state-convergence assertions.
- [ ] Add the local signaling/API/coturn environment.
- [ ] Add direct and forced-relay scenarios.
- [ ] Expose and assert ICE statistics.
- [ ] Add reconnect, late-join, and host-migration tests.

**Exit criteria**:

- The core two-user collaboration regression suite runs locally and in CI without a manual deployment.

### Phase 3: Preview and Device Loop

- [ ] Add per-PR preview deployments.
- [ ] Connect preview builds to isolated staging collaboration services.
- [ ] Run Playwright against the preview URL.
- [ ] Add real iPhone, iPad, and Android nightly jobs.
- [ ] Capture cloud video, console, network, and trace artifacts.

**Exit criteria**:

- Every branch can be tested from physical devices before merging to `main`.

### Phase 4: Fault Injection and Production Confidence

- [ ] Add REST and WebSocket fault injection.
- [ ] Add packet loss, latency, and reorder scenarios.
- [ ] Add server and coturn restart tests.
- [ ] Add production synthetic collaboration canary.
- [ ] Add failure-rate and latency trend reporting.

**Exit criteria**:

- Transport and infrastructure failures produce known, tested recovery behavior and actionable alerts.

### Phase 5: Diagnostic and LLM Feedback Loop

- [ ] Add Download Diagnostics.
- [ ] Record recent high-level user actions.
- [ ] Add baseline/current/diff packaging.
- [ ] Add advisory LLM review for nightly failures.
- [ ] Require replayable scenario output from LLM findings.
- [ ] Track manual regressions converted into automated tests.

**Exit criteria**:

- Manual and automated failures produce sufficient evidence to reproduce, classify, and permanently cover the defect.

## Risks and Mitigations

### Flaky Screenshot Tests

**Risk**: GPU, browser, font, and operating-system differences create false failures.

**Mitigation**:

- Pin the blocking screenshot environment.
- Use semantic and per-layer assertions before RGB comparisons.
- Mask genuinely dynamic UI regions.
- Maintain separate baselines per supported rendering project when necessary.

### False Confidence from Emulation

**Risk**: Desktop WebKit with an iPad viewport may pass while real Mobile Safari fails.

**Mitigation**:

- Maintain a small, high-value real-device matrix.
- Treat emulation as early feedback, not final platform validation.

### Collaboration Timing Flakes

**Risk**: Fixed sleeps and exact message-order assertions make tests unreliable.

**Mitigation**:

- Emit explicit application events.
- Assert eventual state digests with bounded polling.
- Preserve room IDs, seeds, and traces for replay.

### Cloud Performance Noise

**Risk**: Shared browser and device infrastructure causes unstable timing thresholds.

**Mitigation**:

- Gate hard budgets only on pinned hardware.
- Use real-device and cloud tests for trend and compatibility signals.
- Alert on statistically meaningful regression rather than one sample.

### Test Infrastructure Becomes a Second Product

**Risk**: Building a large custom platform delays application development.

**Mitigation**:

- Start with Playwright, existing CI, and a minimal local collaboration topology.
- Use hosted real-device infrastructure rather than maintaining a large device lab.
- Implement only diagnostics that close a demonstrated feedback gap.

### Exposure of Proprietary Layout Data

**Risk**: Screenshots, traces, previews, or diagnostics may expose sensitive designs.

**Mitigation**:

- Use public synthetic fixtures for CI and canaries.
- Include only file hashes in default diagnostics.
- Make screenshot and file attachment opt-in.
- Apply short retention and access controls to preview and cloud artifacts.

## Non-Goals for Initial Phases

- Eliminating all manual exploratory testing.
- Treating LLM visual judgment as a correctness oracle.
- Testing every browser and device combination on every pull request.
- Using production services for routine fault injection.
- Uploading proprietary user layouts into cloud test providers.
- Establishing signoff-quality EDA validation from screenshots alone.
- Blocking pull requests on noisy cloud performance measurements before stable baselines exist.

## External References

- [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)
- [Playwright browser contexts](https://playwright.dev/docs/api/class-browsercontext)
- [Playwright device emulation](https://playwright.dev/docs/emulation)
- [Playwright tracing](https://playwright.dev/docs/api/class-tracing)
- [Playwright continuous integration](https://playwright.dev/docs/ci)
- [W3C WebRTC specification](https://www.w3.org/TR/webrtc/)
- [W3C WebRTC statistics](https://www.w3.org/TR/webrtc-stats/)
- [Chrome DevTools Protocol: Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/)
- [Toxiproxy](https://github.com/Shopify/toxiproxy)
- [Linux `tc netem`](https://man7.org/linux/man-pages/man8/tc-netem.8.html)
- [BrowserStack Playwright on real iOS devices](https://www.browserstack.com/docs/automate/playwright/playwright-ios/nodejs)
- [BrowserStack Local Testing](https://www.browserstack.com/docs/automate/playwright/local-testing)
- [Cloudflare Pages preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Vercel Git preview deployments](https://vercel.com/docs/git)

## Recommended First Execution Slice

The first slice should optimize for immediate reduction in manual effort:

1. Add Playwright with one Chromium desktop project and one emulated iPad project.
2. Add `window.__GDSJAM_TEST__` with fixture loading, exact viewport control, render-idle waiting, and state digests.
3. Implement a deterministic layout tour for one flat and one hierarchical fixture.
4. Implement a two-user host/viewer test using isolated browser contexts and a unique room.
5. Upload trace, screenshot, console, render, and collaboration artifacts on failure.
6. Add a per-PR HTTPS preview URL that uses staging signaling/API/TURN services.

This creates the foundation for rendering goldens, TURN verification, real-device tests, fault injection, and LLM-assisted review without attempting all of those systems simultaneously.

## Progress Log

### 2026-08-05

- Reviewed the repository's current Vitest and CI coverage, Puppeteer preview-generation script, collaboration architecture, signaling/API service, TURN configuration, and previous manual-test requirements.
- Researched current practices for Playwright visual testing, isolated browser contexts, device emulation, WebRTC statistics, fault injection, preview deployments, and real-device automation.
- Defined the layered validation model, testability API, collaboration scenario matrix, CI tiers, real-device strategy, and LLM guardrails.
- No implementation work has started under this DevLog.
- Next: confirm the initial Playwright browser matrix, reference GDS fixtures, staging collaboration environment, and real-device provider.
