from pathlib import Path
import subprocess
import shutil
import json
import sys
import os

os.chdir(Path(__file__).resolve().parent.parent)
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 scripts/backup.py backups/unique-name')
target = Path(sys.argv[1]).resolve()
root = Path('backups').resolve()
if root not in target.parents or target.exists():
    raise SystemExit('Use a new directory inside backups/')
os.umask(0o077)
target.mkdir(parents=True, mode=0o700)
compose = ['docker', 'compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml']
container = subprocess.check_output(compose + ['ps', '-q', 'app'], text=True).strip()
image = subprocess.check_output(['docker', 'inspect', '--format', '{{.Image}}', container], text=True).strip()
(target / 'image-id.txt').write_text(image + '\n')
subprocess.run(['docker', 'stop', container], check=True, stdout=subprocess.DEVNULL)
try:
    # Fingerprints must describe the same stopped-writer snapshot as the dump.
    for script, name in [('account-state.cjs', 'accounts'), ('data-state.cjs', 'data')]:
        state = subprocess.check_output(['docker','run','--rm','-i','--network','rezeptdatenbank_default','--env-file','.env','--entrypoint','node',image],input=Path('scripts',script).read_bytes())
        json.loads(state)
        (target / f'{name}-before.json').write_bytes(state)
    with (target / 'database.sql').open('wb') as output:
        subprocess.run(compose + ['exec', '-T', 'mariadb', 'sh', '-c', 'exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers "$MARIADB_DATABASE"'], stdout=output, check=True)
    subprocess.run(['docker', 'run', '--rm', '--user', '0', '-v', 'rezeptdatenbank_uploads:/data:ro', '-v', f'{target}:/backup', '--entrypoint', 'sh', image, '-c', 'tar -czf /backup/uploads.tar.gz -C /data .'], check=True)
    shutil.copyfile('.env', target / 'environment.env')
    for file in target.iterdir():
        if file.is_file(): file.chmod(0o600)
finally:
    subprocess.run(['docker', 'start', container], check=True, stdout=subprocess.DEVNULL)
print('Backup created:', target)
