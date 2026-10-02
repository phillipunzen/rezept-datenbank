from pathlib import Path
import os
import subprocess
import sys
import json

os.chdir(Path(__file__).resolve().parent.parent)
compose = ['docker', 'compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml', 'exec', '-T', 'mariadb', 'sh', '-c']
# Dedicated disposable database; the live database is never used as a restore target.
subprocess.run(compose + ['mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS rezeptdatenbank_upgrade; CREATE DATABASE rezeptdatenbank_upgrade CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON rezeptdatenbank_upgrade.* TO \'rezeptdatenbank\'@\'%\';"'], check=True)
with Path(sys.argv[1] if len(sys.argv) > 1 else 'backups/pre-public-catalog/database.sql').open('rb') as dump:
    subprocess.run(compose + ['exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" rezeptdatenbank_upgrade'], stdin=dump, check=True)
lines = Path('.env').read_text().splitlines()
lines = [line.rsplit('/', 1)[0] + '/rezeptdatenbank_upgrade' if line.startswith('DATABASE_URL=') else line for line in lines]
envfile = Path('.env.upgrade')
envfile.write_text('\n'.join(lines) + '\n')
envfile.chmod(0o600)
try:
    docker = ['docker', 'run', '--rm', '--network', 'rezeptdatenbank_default', '--env-file', str(envfile), '--entrypoint', 'sh', sys.argv[2] if len(sys.argv) > 2 else 'rezeptdatenbank:0.8.0', '-c']
    before = json.loads(subprocess.check_output(docker + ['node scripts/data-state.cjs'], text=True))
    subprocess.run(docker + ['node_modules/.bin/prisma migrate deploy'], check=True)
    after = json.loads(subprocess.check_output(docker + ['node scripts/data-state.cjs'], text=True))
    if before != after:
        raise RuntimeError('Existing data changed during migration')
    print(json.dumps({'preserved': True, **after}))
finally:
    envfile.unlink(missing_ok=True)
