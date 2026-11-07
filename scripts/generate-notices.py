"""Collect locally resolved dependency license texts before packaging."""
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
metadata = json.loads(subprocess.check_output(['cargo', 'metadata', '--locked', '--format-version', '1'], cwd=root))
parts = ['Enderlink — third-party notices\n\nMinecraft, Paper, Fabric and Java are downloaded separately at the host’s request. Their own licenses and notices remain in their downloaded distributions. Enderlink is not an official Minecraft product and is not approved by or associated with Mojang or Microsoft.\n']
missing = []

def entry(label, directory, license_name, source):
    texts = []
    for path in sorted(directory.iterdir()):
        if path.is_file() and path.name.lower().startswith(('license', 'licence', 'copying', 'copyright', 'notice')):
            # Normalize whitespace so generated notices do not create noisy
            # trailing-space diffs while preserving the license text itself.
            license_text = "\n".join(
                line.rstrip() for line in path.read_text(errors='replace').splitlines()
            )
            texts.append(path.name + '\n' + license_text)
    if not texts:
        missing.append(label)
    parts.append('\n' + '=' * 72 + '\n' + label + '\nLicense: ' + str(license_name) + '\nSource: ' + source + '\n\n' + '\n\n'.join(texts))

for p in sorted(metadata['packages'], key=lambda p: (p['name'], p['version'])):
    if p['id'] in metadata['workspace_members']:
        continue
    directory = pathlib.Path(p['manifest_path']).parent
    # Some workspace packages keep the license at their repository root.
    if p['name'].startswith('playit-'):
        for ancestor in directory.parents:
            if (ancestor / 'LICENSE.txt').is_file():
                directory = ancestor
                break
    entry('Rust: ' + p['name'] + ' ' + p['version'], directory, p.get('license'), p.get('repository') or 'https://crates.io/crates/' + p['name'])
lock = json.loads((root / 'package-lock.json').read_text())
for path, p in sorted(lock['packages'].items()):
    if 'node_modules/' not in path or p.get('dev') or p.get('link'):
        continue
    directory = root / path
    if directory.is_dir():
        entry('JavaScript: ' + path.split('node_modules/')[-1] + ' ' + p['version'], directory, p.get('license'), p.get('resolved', 'npm'))
(root / 'THIRD_PARTY_NOTICES.txt').write_text('\n'.join(parts))
print('Generated THIRD_PARTY_NOTICES.txt. Packages without a top-level license file (license identifiers and source links included): ' + ', '.join(missing))
