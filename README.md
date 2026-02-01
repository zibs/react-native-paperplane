<h1>
  <img src="image.png" alt="paperplane logo" width="150" height="150" /> paperplane
</h1>

Tiny CLI to bump iOS build numbers, build/export with Xcode, and upload to TestFlight.

```text
         /\
        /  \
   ____/____\____
  /   /      \   \
 /___/  o  o  \___\
     \   __   /
      \______/ 
     paperplane
```

License: MIT

## Features

- One-command TestFlight release flow for iOS
- Supports app.config.ts, app.config.js, and app.json (text-only parsing)
- Dry run mode and clean git enforcement
- Deterministic output paths for build artifacts

## Requirements

- Node 18+ or Bun
- Xcode Command Line Tools
- Transporter app installed and signed in (for iTMSTransporter)
- Repo with ios/ and an Xcode workspace
- One of: app.config.ts, app.config.js, app.json

## Install

```bash
npm install -D paperplane
# or
bun add -d paperplane
```

## Quick start

```bash
npx paperplane --dry-run
npx paperplane
```

Bun alternative:

```bash
bunx paperplane --dry-run
bunx paperplane
```

## Local development

```bash
# run locally without publishing
bun src/cli.js --help
# or
node src/cli.js --help
```

Optional global-style bin for development:

```bash
npm link
paperplane --help
```

## Usage

```bash
paperplane [options]
```

### Options

- `--build-number <n>`: Set explicit build number (default: current + 1)
- `--message <msg>`: Override git commit message
- `--dry-run`: Show actions without modifying files or running build/upload
- `--allow-dirty`: Skip clean git check
- `--skip-upload`: Build/export only; skip upload
- `-h, --help`: Show help

## Environment variables

Required for upload (Apple ID auth only):

- `ASC_APPLE_ID`
- `ASC_APP_PASSWORD`

Optional:

- `ASC_ITC_PROVIDER`

iOS overrides:

- `IOS_APP_NAME`
- `IOS_SCHEME`
- `IOS_WORKSPACE`

## Project assumptions

- ios/ contains an Xcode workspace (or set IOS_WORKSPACE).
- Info.plist is at ios/<AppName>/Info.plist.
- Build number is read from text in app.config.ts, app.config.js, or app.json.

## Output paths

Artifacts are written to:

```
ios/build/testflight/<runId>/
```

## Examples

```bash
# dry run
paperplane --dry-run

# explicit build number
paperplane --build-number 42

# build only, no upload
paperplane --skip-upload
```

## FAQ

**Why Bun?**
Bun is fast and works great for CLI workflows. This package also runs on Node 18+.

**Transporter errors?**
Install Transporter from the Mac App Store and sign in once.

## Publishing checklist

- Confirm the package name is available on npm.
- Update `package.json` version.
- Run a quick help check: `node src/cli.js --help`.
- Dry pack: `npm pack` and sanity-check the tarball contents.
- Publish: `npm publish --access public`.

Notes:
- `--access public` is only required for scoped packages, but harmless for unscoped.
