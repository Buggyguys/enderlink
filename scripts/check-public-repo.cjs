const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([
  ".git",
  "target",
  "node_modules",
  "dist",
  "gen",
  "test-results",
  "playwright-report",
]);
const forbiddenExtensions = new Set([
  ".sqlite",
  ".sqlite3",
  ".db",
  ".dmg",
  ".zip",
  ".pem",
  ".p12",
  ".key",
  ".log",
]);
const privacyPatterns = [
  /raduanghel/i,
  /\/Users\/radu/i,
  /jensen-aisle/i,
  /tun\.ply/i,
  /BEGIN [A-Z ]+PRIVATE KEY/i,
  /api[_ -]?key\s*[:=]\s*[A-Za-z0-9_-]{16,}/i,
  /bearer\s+[A-Za-z0-9._-]{16,}/i,
];
const findings = [];

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function isLocalData(file) {
  const name = path.basename(file).toLowerCase();
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    forbiddenExtensions.has(path.extname(name))
  );
}

function checkMarkdownLinks(files) {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const file of files.filter((candidate) => candidate.endsWith(".md"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(linkPattern)) {
      let target = match[1].trim();
      if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1);
      }
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      target = target.split("#", 1)[0];
      if (!target) continue;
      const resolved = path.resolve(path.dirname(file), target);
      if (!fs.existsSync(resolved)) {
        findings.push(`${relative(file)}: broken local link ${target}`);
      }
    }
  }
}

const files = walk(root);
for (const file of files) {
  const rel = relative(file);
  // This file contains the patterns used by the scan itself.
  if (rel === "scripts/check-public-repo.cjs") continue;
  if (isLocalData(file)) {
    findings.push(`${rel}: local data or packaged artifact must stay ignored`);
    continue;
  }
  const contents = fs.readFileSync(file);
  if (contents.includes(0)) continue;
  for (const [index, line] of contents
    .toString("utf8")
    .split(/\r?\n/)
    .entries()) {
    if (privacyPatterns.some((pattern) => pattern.test(line))) {
      findings.push(`${rel}:${index + 1}: possible private data`);
    }
  }
}

checkMarkdownLinks(files);

for (const required of [
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
  ".gitignore",
  ".github/workflows/checks.yml",
  ".github/workflows/release.yml",
]) {
  if (!fs.existsSync(path.join(root, required))) {
    findings.push(`missing required public file ${required}`);
  }
}

if (findings.length) {
  console.error("Public repository check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(
    `Public repository check passed (${files.length} source/docs files scanned).`,
  );
}
