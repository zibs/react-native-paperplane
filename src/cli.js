#!/usr/bin/env node
"use strict";

const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} = require("fs");
const { basename, join, resolve } = require("path");
const { spawn, spawnSync } = require("child_process");

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printBanner();
  printHelp();
  process.exit(0);
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});

async function main() {
  const rootDir = process.cwd();
  printBanner();
  loadDotEnv(resolve(rootDir, ".env"));

  const iosDir = resolve(rootDir, "ios");
  ensureDir(iosDir, "ios directory");

  const config = resolveConfigFile(rootDir);
  const workspacePath = resolveWorkspacePath(iosDir, rootDir);
  const appName = resolveAppName(workspacePath);
  const scheme = process.env.IOS_SCHEME ?? appName;
  const infoPlistPath = resolve(iosDir, appName, "Info.plist");

  ensureFile(infoPlistPath, "Info.plist");

  if (!options.allowDirty) {
    ensureCleanGit(rootDir);
  }

  const configText = readFileSync(config.path, "utf8");
  const buildInfo = readBuildNumber(config, configText);

  if (!buildInfo) {
    die(`Unable to detect build number in ${config.path}.`);
  }

  const nextBuildNumber =
    options.buildNumber ??
    (() => {
      if (buildInfo.current === null) {
        die(`Unable to detect current build number in ${config.path}.`);
      }
      return buildInfo.current + 1;
    })();

  if (!Number.isInteger(nextBuildNumber) || nextBuildNumber <= 0) {
    die("Build number must be a positive integer.");
  }

  if (buildInfo.current !== null && nextBuildNumber === buildInfo.current) {
    die("Build number is already set to that value.");
  }

  const updatedConfigText = updateBuildNumber(
    config,
    configText,
    nextBuildNumber,
    buildInfo.source,
  );
  const infoPlistText = readFileSync(infoPlistPath, "utf8");
  const updatedInfoPlistText = updatePlistBuildNumber(
    infoPlistText,
    nextBuildNumber,
  );

  if (options.dryRun) {
    const currentPlistBuild = readPlistBuildNumber(infoPlistText) ?? "unknown";
    console.log("Dry run:");
    console.log(`- App: ${appName}`);
    console.log(`- Workspace: ${workspacePath}`);
    console.log(`- Scheme: ${scheme}`);
    console.log(
      `- ${basename(config.path)} buildNumber: ${buildInfo.current ?? "unknown"} -> ${nextBuildNumber}`,
    );
    console.log(
      `- Info.plist CFBundleVersion: ${currentPlistBuild} -> ${nextBuildNumber}`,
    );
    console.log(
      "- No files were written, no commit made, no build/export/upload executed.",
    );
    printSuccess({ dryRun: true });
    process.exit(0);
  }

  writeFileSync(config.path, updatedConfigText);
  writeFileSync(infoPlistPath, updatedInfoPlistText);

  const commitMessage =
    options.message ?? `chore(release): bump iOS build to ${nextBuildNumber}`;
  const pathsToStage = [config.path];
  if (isTracked(rootDir, infoPlistPath)) {
    pathsToStage.push(infoPlistPath);
  }
  runOrThrow(rootDir, "git", ["add", ...pathsToStage]);
  runOrThrow(rootDir, "git", ["commit", "-m", commitMessage]);

  const runId = makeRunId();
  const buildRoot = resolve(rootDir, "ios/build/testflight", runId);
  const archivePath = join(buildRoot, `${appName}.xcarchive`);
  const exportPath = join(buildRoot, "export");
  const exportOptionsPath = join(buildRoot, "exportOptions.plist");

  mkdirSync(buildRoot, { recursive: true });
  mkdirSync(exportPath, { recursive: true });
  writeFileSync(exportOptionsPath, buildExportOptionsPlist(), "utf8");

  await runOrThrowAsync(rootDir, "xcodebuild", [
    "-workspace",
    workspacePath,
    "-scheme",
    scheme,
    "-configuration",
    "Release",
    "-sdk",
    "iphoneos",
    "-destination",
    "generic/platform=iOS",
    "-archivePath",
    archivePath,
    "-allowProvisioningUpdates",
    "archive",
  ]);

  await runOrThrowAsync(rootDir, "xcodebuild", [
    "-exportArchive",
    "-archivePath",
    archivePath,
    "-exportOptionsPlist",
    exportOptionsPath,
    "-exportPath",
    exportPath,
    "-allowProvisioningUpdates",
  ]);

  const ipaPath = findIpa(exportPath);
  if (options.skipUpload) {
    console.log(`Build/export complete. IPA ready at: ${ipaPath}`);
    printSuccess({ ipaPath });
    process.exit(0);
  }

  ensureTransporterAvailable(rootDir);
  const uploadArgs = buildUploadArgs(ipaPath);

  await runOrThrowAsync(rootDir, "xcrun", uploadArgs);

  console.log(`Upload complete. IPA: ${ipaPath}`);
  printSuccess({ ipaPath });
}

function parseArgs(args) {
  const options = {
    buildNumber: undefined,
    message: undefined,
    dryRun: false,
    allowDirty: false,
    skipUpload: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--build-number" || arg.startsWith("--build-number=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : args[i + 1];
      if (!value) {
        die("Missing value for --build-number.");
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) {
        die(`Invalid build number: ${value}`);
      }
      options.buildNumber = parsed;
      if (!arg.includes("=")) {
        i += 1;
      }
      continue;
    }

    if (arg === "--message" || arg.startsWith("--message=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : args[i + 1];
      if (!value) {
        die("Missing value for --message.");
      }
      options.message = value;
      if (!arg.includes("=")) {
        i += 1;
      }
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--allow-dirty") {
      options.allowDirty = true;
      continue;
    }

    if (arg === "--skip-upload") {
      options.skipUpload = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    die(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: paperplane [options]

Options:
  --build-number <n>   Set an explicit build number (default: +1)
  --message <msg>      Commit message override
  --dry-run            Show actions without modifying files
  --allow-dirty        Skip clean git check
  --skip-upload        Build/export only; skip Transporter upload
  --help, -h           Show help

Environment:
  IOS_APP_NAME         iOS target folder + scheme (defaults to workspace name)
  IOS_SCHEME           Override the Xcode scheme
  IOS_WORKSPACE        Override the workspace path (relative to repo root)
  ASC_APPLE_ID         Apple ID (required for upload)
  ASC_APP_PASSWORD     App-specific password (required for upload)
  ASC_ITC_PROVIDER     iTMSTransporter provider short name (optional)
`);
}

function printBanner() {
  const banner = [
    "                               __",
    "                          _.-'`  `'-._",
    "                      _.-'    .--.    `-._",
    "                  _.-'      .'    `.      `-._",
    "               .-'         /  /\\    \\         `-.",
    "             .'           /  /  \\    \\           `.",
    "            /            /__/____\\____\\            \\",
    "           /              /  __  \\                  \\",
    "          /              /  /  \\  \\                  \\",
    "         /              /__/    \\__\\                  \\",
    "        /____________________________\\_________________\\",
    "",
    " ____  ____  ____  ____  ____  __     ___  _   _  _____",
    "|  _ \\|  _ \\|  _ \\|  _ \\|  _ \\|  |   / _ \\| \\ | |/  ___|",
    "| |_) | |_) | |_) | |_) | |_) |  |  / /_\\ \\  \\| |\\ `--.",
    "|  __/|  __/|  __/|  __/|  _ <|  |  |  _  | . ` | `--. \\",
    "| |   | |   | |   | |   | |_) |  |__| | | | |\\  |/\\__/ /",
    "\\_|   \\_|   \\_|   \\_|   |____/|_____\\_| |_\\_| \\_/\\____/",
  ];
  console.log(banner.join("\n"));
  console.log("");
}

function printSuccess({ dryRun = false, ipaPath } = {}) {
  console.log("");
  if (dryRun) {
    console.log("paperplane: dry run complete.");
    return;
  }
  if (ipaPath) {
    console.log(`paperplane: done -> ${ipaPath}`);
    return;
  }
  console.log("paperplane: done.");
}

function loadDotEnv(path) {
  try {
    const content = readFileSync(path, "utf8");
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const match = line.match(
        /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
      );
      if (!match) {
        continue;
      }
      const key = match[1];
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
        if (rawLine.includes('"')) {
          value = value
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\\\/g, "\\");
        }
      } else {
        value = value.replace(/\s+#.*$/, "");
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      die(`Failed to read .env file at ${path}`);
    }
  }
}

function resolveConfigFile(rootDir) {
  const candidates = ["app.config.ts", "app.config.js", "app.json"];
  for (const candidate of candidates) {
    const candidatePath = resolve(rootDir, candidate);
    if (existsSync(candidatePath)) {
      return {
        path: candidatePath,
        type: candidate.endsWith(".json") ? "appJson" : "appConfig",
      };
    }
  }
  die(
    "No app config found. Expected one of app.config.ts, app.config.js, or app.json.",
  );
}

function resolveWorkspacePath(iosDir, rootDir) {
  const override = process.env.IOS_WORKSPACE;
  if (override) {
    const resolved = override.startsWith("/")
      ? override
      : resolve(rootDir, override);
    ensureDir(resolved, "workspace");
    return resolved;
  }

  const entries = readdirSync(iosDir, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".xcworkspace"))
    .map((entry) => entry.name);

  if (entries.length === 0) {
    die("No .xcworkspace found in ios/. Set IOS_WORKSPACE.");
  }

  if (entries.length > 1) {
    console.warn(
      `Multiple workspaces found. Using ${entries[0]}. Set IOS_WORKSPACE to override.`,
    );
  }

  return resolve(iosDir, entries[0]);
}

function resolveAppName(workspacePath) {
  return process.env.IOS_APP_NAME ?? basename(workspacePath, ".xcworkspace");
}

function ensureFile(path, label) {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) {
      die(`Expected ${label ?? "file"} at ${path}`);
    }
  } catch {
    die(`Missing required ${label ?? "file"}: ${path}`);
  }
}

function ensureDir(path, label) {
  try {
    const stats = statSync(path);
    if (!stats.isDirectory()) {
      die(`Expected ${label ?? "directory"} at ${path}`);
    }
  } catch {
    die(`Missing required ${label ?? "directory"}: ${path}`);
  }
}

function readBuildNumber(config, text) {
  if (config.type === "appJson") {
    return readBuildNumberFromAppJson(text);
  }
  return readBuildNumberFromAppConfig(text);
}

function readBuildNumberFromAppConfig(text) {
  const iosRegex = /ios\s*:\s*{[\s\S]*?buildNumber\s*:\s*(['"])(\d+)\1/;
  const anyRegex = /buildNumber\s*:\s*(['"])(\d+)\1/;

  const iosMatch = text.match(iosRegex);
  if (iosMatch) {
    return {
      current: Number(iosMatch[2]),
      source: "appConfig:ios",
    };
  }

  const anyMatch = text.match(anyRegex);
  if (anyMatch) {
    return {
      current: Number(anyMatch[2]),
      source: "appConfig:any",
    };
  }

  return null;
}

function readBuildNumberFromAppJson(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    die("app.json is not valid JSON.");
  }

  const iosBuild = json?.expo?.ios?.buildNumber;
  if (iosBuild !== undefined && iosBuild !== null) {
    if (!isDigits(String(iosBuild))) {
      die("expo.ios.buildNumber must be a numeric string.");
    }
    return { current: Number(iosBuild), source: "appJson:expo.ios" };
  }

  const expoBuild = json?.expo?.buildNumber;
  if (expoBuild !== undefined && expoBuild !== null) {
    if (!isDigits(String(expoBuild))) {
      die("expo.buildNumber must be a numeric string.");
    }
    return { current: Number(expoBuild), source: "appJson:expo" };
  }

  return null;
}

function updateBuildNumber(config, text, nextBuildNumber, source) {
  if (config.type === "appJson") {
    return updateBuildNumberInAppJson(text, nextBuildNumber, source);
  }
  return updateBuildNumberInAppConfig(text, nextBuildNumber);
}

function updateBuildNumberInAppConfig(text, nextBuildNumber) {
  const iosRegex = /ios\s*:\s*{[\s\S]*?buildNumber\s*:\s*(['"])(\d+)\1/;
  const anyRegex = /buildNumber\s*:\s*(['"])(\d+)\1/;

  if (iosRegex.test(text)) {
    const updated = text.replace(iosRegex, (match, quote) =>
      match.replace(
        /buildNumber\s*:\s*(['"])\d+\1/,
        `buildNumber: ${quote}${nextBuildNumber}${quote}`,
      ),
    );
    if (updated === text) {
      die("Failed to update buildNumber in app.config.");
    }
    return updated;
  }

  if (anyRegex.test(text)) {
    const updated = text.replace(anyRegex, (_, quote) => {
      return `buildNumber: ${quote}${nextBuildNumber}${quote}`;
    });
    if (updated === text) {
      die("Failed to update buildNumber in app.config.");
    }
    return updated;
  }

  die("Failed to update buildNumber in app.config.");
}

function updateBuildNumberInAppJson(text, nextBuildNumber, source) {
  if (source === "appJson:expo.ios") {
    const iosRegex = /("expo"\s*:\s*{[\s\S]*?"ios"\s*:\s*{[\s\S]*?"buildNumber"\s*:\s*")(\d+)(")/;
    if (!iosRegex.test(text)) {
      die("Failed to update expo.ios.buildNumber in app.json.");
    }
    return text.replace(iosRegex, `$1${nextBuildNumber}$3`);
  }

  const expoRegex = /("expo"\s*:\s*{[\s\S]*?"buildNumber"\s*:\s*")(\d+)(")/;
  if (!expoRegex.test(text)) {
    die("Failed to update expo.buildNumber in app.json.");
  }
  return text.replace(expoRegex, `$1${nextBuildNumber}$3`);
}

function readPlistBuildNumber(plistText) {
  const match = plistText.match(
    /<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/,
  );
  return match ? match[1] : null;
}

function updatePlistBuildNumber(plistText, buildNumber) {
  const updated = plistText.replace(
    /(<key>CFBundleVersion<\/key>\s*<string>)([^<]*)(<\/string>)/,
    `$1${buildNumber}$3`,
  );
  if (updated === plistText) {
    die("Failed to update CFBundleVersion in Info.plist.");
  }
  return updated;
}

function buildExportOptionsPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>uploadBitcode</key>
    <false/>
    <key>compileBitcode</key>
    <false/>
  </dict>
</plist>
`;
}

function findIpa(exportPath) {
  const entries = readdirSync(exportPath);
  const direct = entries.find((entry) => entry.endsWith(".ipa"));
  if (direct) {
    return join(exportPath, direct);
  }
  for (const entry of entries) {
    const fullPath = join(exportPath, entry);
    const stats = statSync(fullPath);
    if (!stats.isDirectory()) {
      continue;
    }
    const nested = readdirSync(fullPath).find((file) => file.endsWith(".ipa"));
    if (nested) {
      return join(fullPath, nested);
    }
  }
  die("No .ipa found after export.");
}

function ensureTransporterAvailable(rootDir) {
  const result = spawnSync("xcrun", ["--find", "iTMSTransporter"], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    die(
      "iTMSTransporter not found. Install the Transporter app from the Mac App Store, then try again.",
    );
  }
}

function buildUploadArgs(ipaPath) {
  const appleId = process.env.ASC_APPLE_ID;
  const applePassword = process.env.ASC_APP_PASSWORD;
  const provider = process.env.ASC_ITC_PROVIDER;

  if (!appleId || !applePassword) {
    die(
      "Missing App Store Connect credentials. Set ASC_APPLE_ID and ASC_APP_PASSWORD.",
    );
  }

  const args = [
    "iTMSTransporter",
    "-m",
    "upload",
    "-assetFile",
    ipaPath,
    "-u",
    appleId,
    "-p",
    applePassword,
  ];

  if (provider) {
    args.push("-itc_provider", provider);
  }

  return args;
}

function makeRunId() {
  const iso = new Date().toISOString();
  return iso.replace("T", "-").replace(/[:]/g, "").replace(/\..+/, "");
}

function runCapture(rootDir, cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    status: result.status ?? 0,
  };
}

function ensureCleanGit(rootDir) {
  const status = runCapture(rootDir, "git", ["status", "--porcelain"]);
  if (status.stdout.trim().length > 0) {
    die(
      "Working tree is not clean. Commit or stash changes first, or pass --allow-dirty.",
    );
  }
}

function isTracked(rootDir, path) {
  const result = spawnSync("git", ["ls-files", "--error-unmatch", path], {
    cwd: rootDir,
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

function runOrThrow(rootDir, cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    die(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function runOrThrowAsync(rootDir, cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: rootDir,
      stdio: "inherit",
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed: ${cmd} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
  });
}

function isDigits(value) {
  return /^\d+$/.test(value);
}

function die(message) {
  console.error(message);
  process.exit(1);
}
