const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;
const steps = [
  ["public repository scan", node, ["scripts/check-public-repo.cjs"]],
  ["version consistency", node, ["scripts/check-version.cjs"]],
  ["React tests", npm, ["test"]],
  ["TypeScript and frontend build", npm, ["run", "build"]],
  ["Chromium UI checks", npm, ["run", "test:ui"]],
  ["prototype checks", node, ["design/verify.cjs"]],
  ["Rust formatting", "cargo", ["fmt", "--all", "--check"]],
  ["Rust workspace tests", "cargo", ["test", "--workspace", "--locked"]],
  [
    "Rust Clippy",
    "cargo",
    [
      "clippy",
      "--workspace",
      "--all-targets",
      "--locked",
      "--",
      "-D",
      "warnings",
    ],
  ],
  ["dependency audit", npm, ["audit", "--audit-level=high"]],
];

if (process.env.ENDERLINK_VALIDATE_WEBKIT === "1") {
  steps.splice(5, 0, ["WebKit UI checks", npm, ["run", "test:ui"]]);
}

for (const [label, command, args] of steps) {
  console.log(`\n==> ${label}`);
  const env = { ...process.env };
  if (label === "Chromium UI checks") env.ENDERLINK_TEST_BROWSER = "chromium";
  if (label === "WebKit UI checks") env.ENDERLINK_TEST_BROWSER = "webkit";
  // npm is a .cmd shim on Windows and must be launched through the shell.
  const spawnOptions = {
    cwd: root,
    env,
    stdio: "inherit",
    ...(process.platform === "win32" && command === "npm.cmd"
      ? { shell: true }
      : {}),
  };
  const result = spawnSync(command, args, spawnOptions);
  if (result.error) {
    console.error(`Could not start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Validation stopped after ${label}.`);
    process.exit(result.status || 1);
  }
}

console.log(
  "\nValidation passed. No live provider, Minecraft server, or app data was used.",
);
