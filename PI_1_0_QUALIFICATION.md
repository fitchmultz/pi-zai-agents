# Pi 1.0 qualification

## Current contract

Pi 1.0.0 is the supported floor. Translation with glossary uploads, slide/poster conversations and exports, and asynchronous video-effect creation/polling/download remain Z.AI's external paid workflows. Native model generation is not equivalent and does not replace them. Existing explicit user-intent/cost guidance, service credentials, request IDs, timeouts, cancellation, artifact URL/path validation and no-replay behavior remain in force.

The native output schema publishes only the existing bounded title/status/summary, local artifact receipts and warnings, and optional raw-response path. Raw service responses and signed URLs are not spread into structured output. Existing text and file artifacts remain available. Failed calls show the actual bounded error rather than a success or generic missing-details label; untrusted error ANSI/control characters are removed before rendering.

## Evidence — 2026-10-01

- Base: `7275e84dbe8e0d7625fb521899529bc95a2b2b52`.
- Official Pi source: `a13d35a742c6ef8462812a28fbe1d8c8b7431c32` (v1.0.0). SDK SHA256 `5482298b995db935f7b96f5d6056fa1c36ac6fc80456be594ef65b83c62b0d30`; bundled CLI SHA256 `e79626f2dd6f94aa45d30f3fa63cd84319a6eefcd150b353cfaf274366926774`.
- Physical Node 24.21.0, eight Pi companion packages at 1.0.0, TypeBox 1.3.27. Checks use isolated HOME/agent profiles and explicit selected `PI_PACKAGE_DIR`; inherited live-fork overrides are discarded.
- `npm run ci` and `npm run check:compat`: typecheck, five native/behavior tests, lint and package dry-run passed with zero skipped/failed tests. Existing timeout, SSE, polling and status checks remain.
- Native official SDK loopback workflow: translation, cwd-relative glossary upload, poster create/request ID/PDF export, video create/request ID/result/artifact download, exact local receipt bytes, signed URL exclusion and reload without extra requests. Actual HTTP 400 plus invalid input render truthful sanitized failures; errors are not replayed.
- Source and extracted package: ordinary ESM import, actual bundled CLI registration, absolute official SDK registration/schema/reload/shutdown checks. Observers assert selected SDK/CLI hashes and complete cohort, not only a version label.
- Fullscreen and regular actual CLI fixtures inspected at 48/100/160 columns, after resizing, collapsed and expanded. Long Unicode output truncates with a full-output path; artifact path/size/open links wrap, and invalid translation input shows `Failed` plus `text is required.`. All service/model responses are owned offline fixtures.

Local logs: `/tmp/zai-agents-pi100-{ci,check,esm,source-probe,packed-probe}.log`. Source/packed identity proofs: `/tmp/pi100-native-services/zai-agents-{source,packed}-proof/identity.json`. UI captures: `/tmp/pi100-native-services/zai-agents-{fullscreen,regular}-{48,100,160,expanded}.txt`, with host identity observations alongside them. Owned UI processes are stopped and generated fixture artifacts removed after inspection.

## Delivery boundaries

Recommended unused version: **0.2.0**, through existing owned npm and GitHub release channels after parent review. No publication, tag or merge is part of this implementation. The older 0.87 cohort-only PR is not overwritten or cherry-picked.

The live fork, managed packages, settings and authentication are untouched. A future minimal 1.0 fork has no immutable qualified candidate yet; official checks do not certify that fork. No paid/provider request, live credential flow, user app mutation, live activation/reload/restart or manually triggered remote CI was attempted. Node 22.19 remains the existing manifest minimum, not a new runtime qualification claim; this evidence is on Node 24.21.0.
