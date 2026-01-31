# paperplane-rn

A tiny Bun-based CLI to bump iOS build numbers, archive/export with Xcode, and upload to TestFlight.

## Requirements
- Bun
- Xcode Command Line Tools
- Transporter app installed and signed in (for `iTMSTransporter`)
- Repo with `ios/` + Xcode workspace
- One of: `app.config.ts`, `app.config.js`, `app.json`

## Install
```bash
bun add -d paperplane-rn
```

## Quick start
```bash
bun x paperplane-rn --dry-run
bun x paperplane-rn
```

## Usage
```bash
paperplane-rn [options]
```

### Options
- `--build-number <n>`: Set explicit build number (default: current + 1)
- `--message <msg>`: Override git commit message
- `--dry-run`: Show actions without modifying files or running build/upload
- `--allow-dirty`: Skip clean git check
- `--skip-upload`: Build/export only; skip upload
- `-h, --help`: Show help

## Environment variables
Required for upload:
- `ASC_APPLE_ID`
- `ASC_APP_PASSWORD`

Optional:
- `ASC_ITC_PROVIDER`

iOS overrides:
- `IOS_APP_NAME`
- `IOS_SCHEME`
- `IOS_WORKSPACE`

## Project assumptions
- `ios/` contains an Xcode workspace (or set `IOS_WORKSPACE`).
- `Info.plist` is at `ios/<AppName>/Info.plist`.
- Build number is read from text in `app.config.ts`, `app.config.js`, or `app.json`.

## Output paths
Artifacts are written to:
```
ios/build/testflight/<runId>/
```

## Examples
```bash
# dry run
bun x paperplane-rn --dry-run

# explicit build number
bun x paperplane-rn --build-number 42

# build only, no upload
bun x paperplane-rn --skip-upload
```

## FAQ
**Why Bun?**
This tool is built for Bun-first workflows and keeps dependencies minimal.

**Transporter errors?**
Install Transporter from the Mac App Store and sign in once.

## License
TBD
