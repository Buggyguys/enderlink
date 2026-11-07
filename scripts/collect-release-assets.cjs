const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.resolve(root, process.argv[2] || "release-assets");
const platform = process.argv[3] || process.platform;
const bundleDirectory = path.resolve(
  root,
  process.argv[4] || "target/release/bundle",
);
const version = JSON.parse(
  fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"),
).version;

const specs = {
  darwin: [
    {
      directory: "dmg",
      extension: /\.dmg$/i,
      name: "Enderlink-macos-arm64.dmg",
    },
  ],
  win32: [
    {
      directory: "nsis",
      extension: /\.exe$/i,
      name: "Enderlink-windows-x64-setup.exe",
    },
  ],
  linux: [
    { directory: "deb", extension: /\.deb$/i, name: "Enderlink-linux-x64.deb" },
    {
      directory: "appimage",
      extension: /\.AppImage$/i,
      name: "Enderlink-linux-x64.AppImage",
    },
  ],
};

function fail(message) {
  console.error(`Release asset collection failed: ${message}`);
  process.exit(1);
}

if (!specs[platform]) fail(`unsupported platform ${platform}`);
if (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length) {
  fail(`${outputDirectory} must be empty before collecting assets`);
}
fs.mkdirSync(outputDirectory, { recursive: true });

for (const spec of specs[platform]) {
  const directory = path.join(bundleDirectory, spec.directory);
  const candidates = fs.existsSync(directory)
    ? fs
        .readdirSync(directory)
        .filter((name) => name.includes(version) && spec.extension.test(name))
        .map((name) => path.join(directory, name))
    : [];
  if (candidates.length !== 1) {
    fail(
      `${spec.directory} expected one ${version} artifact, found ${candidates.length}: ${candidates.map((file) => path.basename(file)).join(", ")}`,
    );
  }
  const destination = path.join(outputDirectory, spec.name);
  fs.copyFileSync(candidates[0], destination);
  const digest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(destination))
    .digest("hex");
  fs.writeFileSync(`${destination}.sha256`, `${digest}  ${spec.name}\n`);
}

console.log(
  `Collected ${specs[platform].length} ${platform} release asset(s) for Enderlink ${version}.`,
);
