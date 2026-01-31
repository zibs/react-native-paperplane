# TestFlight Release CLI — v1 Plan (Bun)

## Purpose
Create a small, Bun-based CLI package that bumps the iOS build number, builds an Xcode archive, exports an IPA, and uploads it to TestFlight. The v1 scope is intentionally narrow and maps to the existing `scripts/release-testflight.ts` behavior.

This plan is detailed to enable an external agent to implement the package in a new repo without prior context.

## Goals
- One-command TestFlight release flow for iOS.
- Minimal API surface, low dependency count, Bun-first.
- Works with Expo-style configs (`app.config.ts`, `app.config.js`, `app.json`).
- Clear preflight errors and deterministic output paths.
- Safe defaults with an optional dry run.

## Non-goals (v1)
- Android build or upload support (explicit v2).
- App Store Connect API key auth.
- Complex config evaluation (e.g., TypeScript runtime execution of `app.config.ts`).
- CI integration beyond basic non-interactive operation.

## Requirements / Assumptions
- Bun is installed and used to run the CLI.
- Xcode command line tools are installed.
- Transporter app is installed, and the user is signed in (required for `iTMSTransporter`).
- Repo includes an `ios/` directory with an Xcode workspace.
- Repo contains one of: `app.config.ts`, `app.config.js`, or `app.json`.
- iOS `Info.plist` exists at `ios/<AppName>/Info.plist` (or similar via `IOS_APP_NAME`).

## CLI Overview (name TBD)
```
<cli-name> [options]
```

### Options
- `--build-number <n>`: Set explicit build number (default: current + 1).
- `--message <msg>`: Override git commit message.
- `--dry-run`: Show actions without modifying files or running build/upload.
- `--allow-dirty`: Skip clean git working tree check.
- `--skip-upload`: Build/export only; do not upload to TestFlight.
- `-h, --help`: Show usage.

### Environment Variables (only these are supported)
- `ASC_APPLE_ID` (required for upload)
- `ASC_APP_PASSWORD` (required for upload)
- `ASC_ITC_PROVIDER` (optional; iTunes Connect provider short name)

### Optional iOS Overrides
- `IOS_APP_NAME`: iOS target folder + default scheme (defaults to workspace name).
- `IOS_SCHEME`: Override Xcode scheme.
- `IOS_WORKSPACE`: Override workspace path (relative to repo root or absolute).

## File Discovery
- Root directory = `process.cwd()`
- `ios/` directory must exist.
- Workspace:
  - If `IOS_WORKSPACE` is set, resolve it (absolute or relative) and verify it exists.
  - Otherwise, pick the first `*.xcworkspace` under `ios/`.
  - Error if none found.
- App name:
  - Default to `basename(workspace, ".xcworkspace")`.
  - Override with `IOS_APP_NAME`.
- Info.plist:
  - `ios/<AppName>/Info.plist` must exist.

## Build Number Source of Truth
Support these config files (first match wins):
1. `app.config.ts`
2. `app.config.js`
3. `app.json`

### Extraction Rules
- For `app.config.ts` / `app.config.js`:
  - Treat file as text. Do **not** execute/require it.
  - Find the first `buildNumber` string in the file.
  - Prefer `ios: { buildNumber: "N" }` if present.
  - Fallback to any `buildNumber: "N"` match.
- For `app.json`:
  - Parse as JSON; read `expo.ios.buildNumber` (primary), then `expo.buildNumber` (fallback).

### Update Rules
- Update the same file where the build number was found.
- Ensure the update is minimal and stable (single replacement).
- If no build number is found in any config file, exit with a helpful error.

## Info.plist Update
- Read `CFBundleVersion` from `ios/<AppName>/Info.plist`.
- Replace its value with the new build number.
- Error if the key is not found or if replacement fails.

## Git Behavior
- If `--allow-dirty` is **not** set, `git status --porcelain` must be empty.
- Stage modified config file and Info.plist (only if tracked).
- Commit message default: `chore(release): bump iOS build to <N>`
- Allow overriding commit message via `--message`.

## Build & Export
- Output root: `ios/build/testflight/<runId>/`
- `runId` format: ISO timestamp with safe characters (e.g., `2026-01-31-185501`).
- Archive path: `<buildRoot>/<AppName>.xcarchive`
- Export path: `<buildRoot>/export`
- Export options plist should be generated in `<buildRoot>/exportOptions.plist`.

### Xcodebuild Commands
1) Archive
```
xcodebuild \
  -workspace <workspacePath> \
  -scheme <scheme> \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  -archivePath <archivePath> \
  -allowProvisioningUpdates \
  archive
```

2) Export
```
xcodebuild \
  -exportArchive \
  -archivePath <archivePath> \
  -exportOptionsPlist <exportOptionsPlist> \
  -exportPath <exportPath> \
  -allowProvisioningUpdates
```

### Export Options Plist
```
method: app-store-connect
signingStyle: automatic
uploadBitcode: false
compileBitcode: false
```

## IPA Discovery
- Find `*.ipa` directly under `<exportPath>`.
- If not found, search one level deeper.
- Error if no IPA found.

## Upload (TestFlight)
- Check that `iTMSTransporter` is available via `xcrun --find iTMSTransporter`.
- Build upload command using Apple ID + app-specific password:
```
xcrun iTMSTransporter \
  -m upload \
  -assetFile <ipaPath> \
  -u <ASC_APPLE_ID> \
  -p <ASC_APP_PASSWORD> \
  -itc_provider <ASC_ITC_PROVIDER>   # only if provided
```
- If `--skip-upload` is set, skip upload and output IPA path.

## Dry Run
- Print resolved values:
  - App name, workspace, scheme
  - Build number current -> next
  - Info.plist CFBundleVersion current -> next
- Confirm no files are written, no git commit, no build/export, no upload.

## Error Handling
- Use clear, actionable error messages.
- Exit non-zero on failure.
- Fail fast on missing files, build number parse/update failure, or missing credentials.

## Logging / Output
- Keep console output short, human-readable.
- Always output the IPA path on success.

## Packaging Plan
- Bun-based package with a single `bin` entry.
- Prefer minimal dependencies (built-ins only).
- README + LICENSE + small example.

## README Skeleton
1. Title + one-liner
2. Requirements (Bun, Xcode CLI, Transporter)
3. Install
4. Quick start
5. Usage (options)
6. Environment variables
7. Project assumptions
8. Output paths
9. Examples (dry run, build only, upload)
10. FAQ (why Bun, troubleshooting Transporter)

## Implementation Checklist
1. CLI arg parsing + help
2. `.env` loader (do not override existing env vars)
3. File discovery for workspace + config file
4. Build number extraction + validation
5. Update app config + Info.plist
6. Git commit flow
7. xcodebuild archive + export
8. IPA discovery
9. Transporter check + upload
10. Dry run pathway
11. README + example

## V2 (Future)
- Android build/export (AAB/APK) support
- App Store Connect API key auth
- Config path override flag
- Additional reporters (JSON output for CI)
