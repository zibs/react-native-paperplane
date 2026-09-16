"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const test = require("node:test");

const cli = resolve(__dirname, "../src/cli.js");
const dummyPassword = "dummy-app-specific-password";

// Every executable on the fixture PATH is fake. No test calls real Git, Xcode,
// Transporter, or Apple's services, even when exercising a complete release.
const fakeCommand = `#!${process.execPath}
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.PAPERPLANE_TEST_LOG, JSON.stringify({ command, args }) + "\\n");
const failure = process.env.PAPERPLANE_TEST_FAILURE;
if (command === "git") {
  if (args[0] === "status" && failure === "git-status") process.exit(1);
  if (args[0] === "var" && failure === args[1]) process.exit(1);
  if (args[0] === "ls-files") process.exit(1);
  if (args[0] === "commit" && failure === "commit") {
    console.error("Hook echoed " + process.env.ASC_APP_PASSWORD);
    process.exit(1);
  }
} else if (command === "xcodebuild") {
  if (args[0] === "-version") {
    if (failure === "xcode") process.exit(1);
    console.log("Xcode 27.0");
  } else if (args[0] === "-exportArchive") {
    const output = args[args.indexOf("-exportPath") + 1];
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "Fixture.ipa"), "dummy IPA");
  } else if (failure === "archive") {
    console.error("Archive failed with " + process.env.ASC_APP_PASSWORD);
    process.exit(1);
  }
} else if (command === "xcrun") {
  if (args[0] === "--sdk") {
    if (failure === "sdk") process.exit(1);
    console.log("/fake/iPhoneOS27.sdk");
  } else if (args[0] === "--find") {
    if (failure === "transporter") process.exit(1);
    console.log("/fake/iTMSTransporter");
  } else if (args[0] === "iTMSTransporter" && failure === "upload") {
    const password = args[args.indexOf("-p") + 1];
    // Deliberately echo credentials across chunks, with no final stderr newline.
    process.stdout.write("Upload failed: " + password.slice(0, 9));
    setTimeout(() => {
      process.stdout.write(password.slice(9) + "\\n");
      process.stderr.write("Transporter echoed " + password);
      process.exitCode = 1;
    }, 20);
  }
}
`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "paperplane-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const command of ["git", "xcodebuild", "xcrun"]) {
    writeFileSync(join(bin, command), fakeCommand, { mode: 0o755 });
  }
  mkdirSync(join(root, "ios/Fixture.xcworkspace"), { recursive: true });
  mkdirSync(join(root, "ios/Fixture"));
  const configPath = join(root, "app.config.ts");
  const plistPath = join(root, "ios/Fixture/Info.plist");
  const originalConfig = 'export default { ios: { buildNumber: "7" } };\n';
  const originalPlist =
    "<plist><dict><key>CFBundleVersion</key><string>7</string></dict></plist>\n";
  writeFileSync(configPath, originalConfig);
  writeFileSync(plistPath, originalPlist);
  const log = join(root, "commands.jsonl");
  const env = {
    ...process.env,
    PATH: bin,
    PAPERPLANE_TEST_LOG: log,
    PAPERPLANE_TEST_FAILURE: "",
    ASC_APPLE_ID: "dummy@example.invalid",
    ASC_APP_PASSWORD: dummyPassword,
    ASC_ITC_PROVIDER: "",
    IOS_APP_NAME: "",
    IOS_SCHEME: "",
    IOS_WORKSPACE: "",
  };
  // Empty override values would override inferred defaults in the real CLI.
  for (const key of ["IOS_APP_NAME", "IOS_SCHEME", "IOS_WORKSPACE"])
    delete env[key];

  return {
    root,
    run(args = [], overrides = {}) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        env: { ...env, ...overrides },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.ifError(result.error);
      return { ...result, output: result.stdout + result.stderr };
    },
    commands() {
      return existsSync(log)
        ? readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(JSON.parse)
        : [];
    },
    assertUntouched() {
      assert.equal(readFileSync(configPath, "utf8"), originalConfig);
      assert.equal(readFileSync(plistPath, "utf8"), originalPlist);
      assert.equal(existsSync(join(root, "ios/build")), false);
      assert.equal(
        this.commands().some(
          ({ args }) =>
            [
              "add",
              "commit",
              "archive",
              "-exportArchive",
              "iTMSTransporter",
            ].includes(args[0]) || args.includes("archive"),
        ),
        false,
      );
    },
  };
}

for (const [failure, expected] of [
  ["xcode", /Command failed: xcodebuild -version/],
  ["sdk", /Command failed: xcrun --sdk iphoneos/],
  ["GIT_AUTHOR_IDENT", /Git GIT_AUTHOR_IDENT is unavailable/],
  ["GIT_COMMITTER_IDENT", /Git GIT_COMMITTER_IDENT is unavailable/],
  ["transporter", /iTMSTransporter not found/],
  ["git-status", /Unable to check Git status/],
]) {
  test(`${failure} preflight failure leaves build numbers and Git untouched`, (t) => {
    const project = fixture(t);
    const result = project.run([], { PAPERPLANE_TEST_FAILURE: failure });
    assert.equal(result.status, 1);
    assert.match(result.output, expected);
    project.assertUntouched();
  });
}

for (const key of ["ASC_APPLE_ID", "ASC_APP_PASSWORD"]) {
  test(`missing ${key} fails before build-number mutation`, (t) => {
    const project = fixture(t);
    const result = project.run([], { [key]: "" });
    assert.equal(result.status, 1);
    assert.match(result.output, /Missing App Store Connect credentials/);
    project.assertUntouched();
  });
}

test("dry run does not require Xcode or upload credentials", (t) => {
  const project = fixture(t);
  const result = project.run(["--dry-run"], {
    PAPERPLANE_TEST_FAILURE: "xcode",
    ASC_APPLE_ID: "",
    ASC_APP_PASSWORD: "",
  });
  assert.equal(result.status, 0);
  assert.match(result.output, /buildNumber: 7 -> 8/);
  assert.equal(
    project.commands().some(({ command }) => command !== "git"),
    false,
  );
  project.assertUntouched();
});

test("a missing Git executable fails closed before touching build numbers", (t) => {
  const project = fixture(t);
  rmSync(join(project.root, "bin/git"));
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.output, /Unable to check Git status/);
  project.assertUntouched();
});

test("a missing Xcode executable fails before touching build numbers", (t) => {
  const project = fixture(t);
  rmSync(join(project.root, "bin/xcodebuild"));
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.output, /Command failed: xcodebuild -version/);
  project.assertUntouched();
});

test("skip-upload exports with modern options without Transporter or credentials", (t) => {
  const project = fixture(t);
  const result = project.run(["--skip-upload"], {
    PAPERPLANE_TEST_FAILURE: "transporter",
    ASC_APPLE_ID: "",
    ASC_APP_PASSWORD: "",
  });
  assert.equal(result.status, 0);
  const commands = project.commands();
  assert.equal(commands.filter(({ args }) => args[0] === "commit").length, 1);
  assert.equal(
    commands.some(({ args }) =>
      ["--find", "iTMSTransporter"].includes(args[0]),
    ),
    false,
  );
  const exported = commands.find(({ args }) => args[0] === "-exportArchive");
  assert.ok(exported);
  const plist = readFileSync(
    exported.args[exported.args.indexOf("-exportOptionsPlist") + 1],
    "utf8",
  );
  assert.match(plist, /<string>app-store-connect<\/string>/);
  assert.doesNotMatch(plist, /Bitcode/);
  assert.ok(
    commands.some(
      ({ args }) => args.includes("iphoneos") && args.includes("archive"),
    ),
  );
});

test("upload failure redacts password from failure message and split child output", (t) => {
  const project = fixture(t);
  const result = project.run([], { PAPERPLANE_TEST_FAILURE: "upload" });
  assert.equal(result.status, 1);
  assert.match(result.output, /Command failed: xcrun iTMSTransporter/);
  assert.match(result.stdout, /Upload failed: \[REDACTED\]/);
  assert.match(result.stderr, /Transporter echoed \[REDACTED\]/);
  assert.equal(result.output.includes(dummyPassword), false);
  assert.ok(
    project
      .commands()
      .some(
        ({ args }) =>
          args[0] === "iTMSTransporter" && args.includes(dummyPassword),
      ),
  );
});

test("archive failure also redacts an environment password echoed by Xcode", (t) => {
  const project = fixture(t);
  const result = project.run([], { PAPERPLANE_TEST_FAILURE: "archive" });
  assert.equal(result.status, 1);
  assert.match(result.output, /Archive failed with \[REDACTED\]/);
  assert.equal(result.output.includes(dummyPassword), false);
});

test("synchronous command output also redacts an environment password", (t) => {
  const project = fixture(t);
  const result = project.run([], { PAPERPLANE_TEST_FAILURE: "commit" });
  assert.equal(result.status, 1);
  assert.match(result.output, /Hook echoed \[REDACTED\]/);
  assert.match(result.output, /Command failed: git commit/);
  assert.equal(result.output.includes(dummyPassword), false);
});

test("successful upload preflights before commit and preserves the normal release path", (t) => {
  const project = fixture(t);
  const result = project.run();
  assert.equal(result.status, 0);
  assert.match(result.output, /Upload complete/);
  const commands = project.commands();
  const commitIndex = commands.findIndex(({ args }) => args[0] === "commit");
  const transporterIndex = commands.findIndex(
    ({ args }) => args[0] === "--find",
  );
  const uploadIndex = commands.findIndex(
    ({ args }) => args[0] === "iTMSTransporter",
  );
  assert.ok(transporterIndex >= 0 && transporterIndex < commitIndex);
  assert.ok(uploadIndex > commitIndex);
  assert.match(
    readFileSync(join(project.root, "app.config.ts"), "utf8"),
    /buildNumber: "8"/,
  );
  assert.match(
    readFileSync(join(project.root, "ios/Fixture/Info.plist"), "utf8"),
    /<string>8<\/string>/,
  );
});
