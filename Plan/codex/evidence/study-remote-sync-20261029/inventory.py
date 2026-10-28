import collections, concurrent.futures, datetime, hashlib, json, os, stat, subprocess, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
os.environ['GIT_OPTIONAL_LOCKS'] = '0'
def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])
def paths(*args):
    return set(x.decode('utf-8') for x in git(*args).split(b'\0') if x)
tracked = paths('ls-files', '-z', '--cached')
untracked = paths('ls-files', '-z', '--others', '--exclude-standard')
candidates = tracked | untracked
document_extras = set()
for top in ['docs', 'Plan']:
    for directory, dirs, files in os.walk(root / top, followlinks=False):
        dirs[:] = [d for d in dirs if d not in ['.git', 'node_modules', '__pycache__', '.tmp']]
        for name in files:
            if name in ['Thumbs.db', '.DS_Store']:
                continue
            rel = (Path(directory) / name).relative_to(root).as_posix()
            if rel not in candidates:
                document_extras.add(rel)
candidates |= document_extras
excluded = []
errors = []
missing = []
def inspect(rel):
    path = root / rel
    name = path.name
    if (name == '.env' or (name.startswith('.env.') and name != '.env.example')
        or name in ['auth.json', 'qitu-ports.env'] or name.startswith(('id_rsa','id_ed25519'))
        or path.suffix in ['.key','.pem','.p12','.pfx']):
        excluded.append(rel)
        return None
    try:
        before = path.lstat()
        if stat.S_ISLNK(before.st_mode):
            target = os.readlink(path)
            return rel, {'kind':'symlink','target':target,'sha256':hashlib.sha256(target.encode()).hexdigest(),'size':len(target)}
        if not stat.S_ISREG(before.st_mode):
            errors.append({'path':rel,'error':'not a regular file'})
            return None
        data = path.read_bytes()
        after = path.stat()
        if (before.st_mtime_ns,before.st_size) != (after.st_mtime_ns,after.st_size):
            errors.append({'path':rel,'error':'changed while reading'})
        row = {'kind':'file','sha256':hashlib.sha256(data).hexdigest(),'size':len(data),'mtime_ns':after.st_mtime_ns,'mode':oct(stat.S_IMODE(after.st_mode))}
        if b'\0' not in data:
            row['lf_sha256'] = hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()
        return rel,row
    except FileNotFoundError:
        missing.append(rel)
    except Exception as exc:
        errors.append({'path':rel,'error':type(exc).__name__})
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    files = dict(row for row in pool.map(inspect, sorted(candidates)) if row)
status_raw = git('status','--porcelain=v1','-z','--untracked-files=all').decode('utf-8').split('\0')
status = [{'status':row[:2],'path':row[3:]} for row in status_raw if row]
changed = sorted(paths('diff','--name-only','HEAD','-z') | untracked)
ignored = sorted(paths('ls-files','-z','--others','--ignored','--exclude-standard','--directory'))
print(json.dumps({'root':str(root),'started_utc':started,'finished_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'head':git('rev-parse','HEAD').decode().strip(),'branch':git('branch','--show-current').decode().strip(),
    'status':status,'changed_from_head':changed,'ignored':ignored,'document_extras':sorted(document_extras),
    'excluded_sensitive_paths':excluded,'missing_tracked':sorted(set(missing)&tracked),'errors':errors,'files':files},ensure_ascii=False))
