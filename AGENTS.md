# Repository Guidelines

## Project Structure & Module Organization
- `testflight-release-package-plan.md` contains the v1 implementation plan for a Bun-based TestFlight release CLI.
- No source code, tests, or assets are present yet; this repo currently serves as a design/requirements document.
- If you add code, prefer a simple layout such as `src/` for implementation, `tests/` for test files, and `docs/` for additional design notes.

## Build, Test, and Development Commands
- There are no build or test commands defined in this repository at this time.
- Once implementation starts, document the exact commands here (for example: `bun run build`, `bun test`, or `bun run dev`).

## Coding Style & Naming Conventions
- No style or lint tooling is configured yet.
- When code is added, keep the CLI entrypoint explicit (for example `src/cli.ts`) and use clear, action-based function names (for example `resolveWorkspace`, `bumpBuildNumber`).
- Match the plan’s terminology (e.g., `buildNumber`, `Info.plist`, `IOS_WORKSPACE`) to avoid drift.

## Testing Guidelines
- No tests are defined yet.
- If tests are added, name them to match the behavior (for example `build-number.test.ts`) and keep fixtures in a small `tests/fixtures/` directory.

## Commit & Pull Request Guidelines
- This directory is not a Git repository, so there is no commit history to infer conventions from.
- If you initialize Git, use a simple conventional format such as `chore(release): bump iOS build to <N>` or `feat: add build number extraction`.
- For pull requests, include a short summary, link related issues, and list any manual validation steps (e.g., “ran `xcodebuild` archive”).

## Configuration & Environment Notes
- The plan assumes Bun, Xcode command line tools, and Apple’s Transporter app are installed.
- Expected repo inputs include `ios/` with an Xcode workspace and one of `app.config.ts`, `app.config.js`, or `app.json`.
