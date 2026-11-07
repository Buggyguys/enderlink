const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"),
);
const expectedFromTag =
  process.env.GITHUB_REF_NAME?.match(/^v(\d+\.\d+\.\d+)$/)?.[1];
const expected = process.argv[2] || expectedFromTag || packageJson.version;
const versions = new Map([
  ["apps/desktop/package.json", packageJson.version],
  [
    "apps/desktop/src-tauri/tauri.conf.json",
    JSON.parse(
      fs.readFileSync(
        path.join(root, "apps/desktop/src-tauri/tauri.conf.json"),
        "utf8",
      ),
    ).version,
  ],
]);

for (const file of [
  "crates/core/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.toml",
]) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const match = text.match(/^version\s*=\s*"([^"]+)"/m);
  versions.set(file, match?.[1] || "");
}

const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
versions.set(
  "package-lock.json#apps/desktop",
  lock.packages?.["apps/desktop"]?.version || "",
);

const invalid = [...versions.entries()].filter(
  ([, version]) => version !== expected,
);
if (invalid.length) {
  console.error(`Version check failed; expected ${expected}:`);
  for (const [file, version] of invalid)
    console.error(`- ${file}: ${version || "missing"}`);
  process.exitCode = 1;
} else {
  console.log(`Version check passed: ${expected}.`);
}
