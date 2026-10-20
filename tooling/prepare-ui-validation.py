"""Copy source into a disposable local build tree; never copy env, auth or raw UI evidence."""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
target = Path(sys.argv[1]).resolve()
if target == root or root in target.parents:
    raise SystemExit('Use a separate disposable validation directory')
allowed = ('apps/', 'packages/', 'services/', 'tooling/', 'database/', '.agents/skills/')
names = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=root).decode().split('\0')
# Product image assets can be ignored by a broad image rule during parallel design work.
# They are needed to resolve the UI's static imports, and contain no runtime credentials.
names += [str(p.relative_to(root)).replace('\\', '/') for p in (root / 'packages/ui/assets').rglob('*') if p.is_file()]
names = sorted(set(names))
count = 0
for name in names:
    if not name or not (name.startswith(allowed) or '/' not in name):
        continue
    path = Path(name)
    if any(part in {'.env', '.git', '.pi', '.next', 'node_modules', 'dist', '.tmp'} or part.startswith('.env.') for part in path.parts):
        continue
    if path.suffix.lower() in {'.pem', '.key', '.pfx', '.bat'} or 'qitu-ports.env' in name and not name.endswith('.example'):
        continue
    source = root / path
    if not source.is_file():
        continue
    destination = target / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists() or source.read_bytes() != destination.read_bytes():
        shutil.copy2(source, destination)
    count += 1
print(f'Copied {count} source files to {target}; no runtime secrets or dependencies copied.')
