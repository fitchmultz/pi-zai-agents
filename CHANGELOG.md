# Changelog

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
