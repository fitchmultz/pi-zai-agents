# Changelog

## 0.2.10 - 2026-11-09

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- test: check untrusted errors before native rendering (#37) ([02583c4](https://github.com/fitchmultz/pi-zai-agents/commit/02583c42d8e46f7c8ffde5f6934938bed62f1720))

### What's Changed
* Test error sanitization before native rendering by @fitchmultz in https://github.com/fitchmultz/pi-zai-agents/pull/37


**Full Changelog**: https://github.com/fitchmultz/pi-zai-agents/compare/v0.2.9...v0.2.10

## 0.2.9 - 2026-11-03

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Skip no-op releases and restate malformed remediation dispositions (#35) ([df81197](https://github.com/fitchmultz/pi-zai-agents/commit/df81197e12cc20ccca9ba0cb16a2ce3a59bc489a))

### What's Changed
* Skip no-op releases and restate malformed remediation dispositions by @fitchmultz in https://github.com/fitchmultz/pi-zai-agents/pull/35


**Full Changelog**: https://github.com/fitchmultz/pi-zai-agents/compare/v0.2.8...v0.2.9

## 0.2.8 - 2026-11-03

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Release metadata only: PR #32 ([f7acac0](https://github.com/fitchmultz/pi-zai-agents/commit/f7acac0e0a210034559733467e867b26512e6613)) was already shipped in [v0.2.7](https://github.com/fitchmultz/pi-zai-agents/releases/tag/v0.2.7), so this release contains no new source changes.

**Full Changelog**: https://github.com/fitchmultz/pi-zai-agents/compare/v0.2.7...v0.2.8

## 0.2.7 - 2026-11-03

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Merge pull request #31 from fitchmultz/npm-version-queue-1 ([039c067](https://github.com/fitchmultz/pi-zai-agents/commit/039c067b02f150abe5677a3bffee7087ba4405d9))

### What's Changed
* Coalesce queued npm version runs by @fitchmultz in https://github.com/fitchmultz/pi-zai-agents/pull/31
* Restore queue: max and the final newline in npm-version.yml by @fitchmultz in https://github.com/fitchmultz/pi-zai-agents/pull/32


**Full Changelog**: https://github.com/fitchmultz/pi-zai-agents/compare/v0.2.6...v0.2.7

## 0.2.6 - 2026-11-02

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Recheck unreported Cursor reviews in automatic releases (#29) ([2275ce3](https://github.com/fitchmultz/pi-zai-agents/commit/2275ce3bc04ccf4af887c41a20f95cb727d950e9))

### What's Changed
* Recheck unreported Cursor reviews in automatic releases by @fitchmultz in https://github.com/fitchmultz/pi-zai-agents/pull/29


**Full Changelog**: https://github.com/fitchmultz/pi-zai-agents/compare/v0.2.5...v0.2.6

## 0.2.5 - 2026-11-02

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Raise the Pi floor to 1.5.0 (#27) ([19e009a](https://github.com/fitchmultz/pi-zai-agents/commit/19e009adadc796a8e8eb852f8ffdac96fdf719c2))

### What's Changed
* Raise the Pi floor to 1.5.0 by @fitchmultz in https://github.com/fitchmultz/pi-zai-agents/pull/27


**Full Changelog**: https://github.com/fitchmultz/pi-zai-agents/compare/v0.2.4...v0.2.5

## 0.2.4 - 2026-11-01

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Use direct Flash for automatic release remediation (#25) ([7f3d6d8](https://github.com/fitchmultz/pi-zai-agents/commit/7f3d6d8e3302828278736256ff8abe41687d093c))

### What's Changed
* Use direct Flash for necessary release remediation by @fitchmultz in https://github.com/fitchmultz/pi-zai-agents/pull/25


**Full Changelog**: https://github.com/fitchmultz/pi-zai-agents/compare/v0.2.3...v0.2.4

## 0.2.3 - 2026-11-01

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Automate reviewed npm patch releases (#23) ([450326c](https://github.com/fitchmultz/pi-zai-agents/commit/450326c6480482d1f70aaadd76619c9abba70e67))

### What's Changed
* Automate reviewed npm patch releases by @fitchmultz in https://github.com/fitchmultz/pi-zai-agents/pull/23


**Full Changelog**: https://github.com/fitchmultz/pi-zai-agents/compare/v0.2.2...v0.2.3

## 0.2.2 - 2026-10-31

- Link the supported Pi compatibility floor and qualification evidence without pinning a host version in the README.

## 0.2.1 - 2026-10-31

- Reuse one serialized response for result previews and raw artifacts, reducing repeated work on large agent responses.

## 0.2.0 - 2026-10-01

- Modernize the development cohort and suggested support floor to Pi 1.0.0, retaining optional wildcard host peers and the paid Translation/Glossary, Slide/Poster and Video Agent workflows.
- Import `StringEnum` from the supported root export; no older-runtime shim or native-image-service replacement is needed.
- Add native `outputSchema`/`structuredContent` for bounded existing outcomes and local artifact receipts, without exposing raw service responses or signed artifact URLs.
- Qualify translation, glossary upload, poster creation/export, video task receipt/result/download and invalid-input failure in the actual native tool loop against isolated loopback fixtures, including request IDs and reload without replay.
- Render native failures truthfully with bounded actual error content, rather than hiding errors behind a generic result label when details are absent.

## 0.1.6 - 2026-07-16

- update the local Pi development lock and validation baseline to `@earendil-works/*` `0.80.9`; the Z.AI agent tool does not use the removed SDK model/auth options

## 0.1.5 - 2026-07-14

- update the local Pi development lock and validation baseline to `@earendil-works/*` `0.80.7`

## 0.1.4 - 2026-06-24

- keep Z.AI request timeout/cancellation active through JSON body reads, uploads, and SSE stream consumption
- make `/zai-agents-status` report the package version from `package.json` and emit useful output in non-UI modes
- clamp video polling settings, improve malformed SSE errors, reduce tool-result prompt noise, and use Pi keybinding hints in TUI rendering
- update the local Pi development baseline to `@earendil-works/*` `0.80.2`
- add no-network tests and `npm run ci`

## 0.1.3 - 2026-06-23

- updated the local pi development baseline to `@earendil-works/*` `0.80.1` and refreshed the npm lockfile
- moved the `StringEnum` import to `@earendil-works/pi-ai/compat`, matching the Pi 0.80 source typechecking migration guidance

## 0.1.2 - 2026-06-22

- updated the local pi development baseline to `@earendil-works/*` `0.79.10` and refreshed the npm lockfile
- ran typecheck validation and an isolated Pi package-load smoke under pi `0.79.10`

## 0.1.1 - 2026-06-15

- updated the local pi development baseline to `@earendil-works/*` `0.79.4` and refreshed the npm lockfile
- ran typecheck and audit validation under pi `0.79.4`

## 0.1.0 - 2026-06-05

- Initial pi extension package for non-MCP Z.AI Agent API products.
- Added three product-level tools: Translation, Slide/Poster, and Video Template. Shared upload/export/async behavior is folded into those tools to minimize tool count.
- Added shared API client behavior for Bearer auth, timeouts, JSON errors, SSE parsing, compact TUI rendering, raw response capture, artifact downloads, cwd-relative path handling, and truncated-summary recovery.
- Documented the Z.AI Agent API integration contract, pricing warnings, file retention, supported templates, strategies, environment variables, and verification steps.
