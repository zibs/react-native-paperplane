# Repository Guidelines

## Project Structure & Module Organization
- `testflight-release-package-plan.md` contains the v1 implementation plan for a Node/Bun TestFlight release CLI.
- v1 auth is Apple ID + app-specific password only; no App Store Connect API key flow.
- Build number parsing is text-only; do not execute `app.config.ts` or `app.config.js`.
- Supported config files, first match wins: `app.config.ts`, `app.config.js`, `app.json`.
- Output convention: `ios/build/testflight/<runId>/` with archive + export output.
- Non-goals: Android support, ASC API key auth, CI polish.
- CLI entrypoint is `src/cli.js`.
- Prefer a simple layout such as `src/` for implementation, `tests/` for test files, and `docs/` for additional design notes.

## Build, Test, and Development Commands
- Local dev (Node): `npm run dev` or `node src/cli.js --help`.
- Local dev (Bun): `npm run dev:bun` or `bun src/cli.js --help`.
- No automated tests are defined yet.

## Coding Style & Naming Conventions
- No style or lint tooling is configured yet.
- When code is added, keep the CLI entrypoint explicit (for example `src/cli.ts`) and use clear, action-based function names (for example `resolveWorkspace`, `bumpBuildNumber`).
- Match the plan’s terminology (e.g., `buildNumber`, `Info.plist`, `IOS_WORKSPACE`) to avoid drift.

## Testing Guidelines
- No tests are defined yet.
- If tests are added, name them to match the behavior (for example `build-number.test.ts`) and keep fixtures in a small `tests/fixtures/` directory.

## Commit & Pull Request Guidelines
- Use a simple conventional commit format such as `chore(release): bump iOS build to <N>` or `feat: add build number extraction`.
- For pull requests, include a short summary, link related issues, and list any manual validation steps (e.g., “ran `xcodebuild` archive”).

## Configuration & Environment Notes
- The plan assumes Bun, Xcode command line tools, and Apple’s Transporter app are installed.
- Expected repo inputs include `ios/` with an Xcode workspace and one of `app.config.ts`, `app.config.js`, or `app.json`.
- Env vars (upload): `ASC_APPLE_ID`, `ASC_APP_PASSWORD`, optional `ASC_ITC_PROVIDER`.
- iOS overrides: `IOS_APP_NAME`, `IOS_SCHEME`, `IOS_WORKSPACE`.
