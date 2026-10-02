"""Restore a trusted backup into an isolated database, upload volume and container."""
from pathlib import Path
import subprocess, json, sys, os, urllib.request, time, tarfile, hashlib
os.chdir(Path(__file__).resolve().parent.parent)
if len(sys.argv)!=3: raise SystemExit('Usage: python3 scripts/test-restore.py backups/name image')
backup=Path(sys.argv[1]).resolve();image=sys.argv[2]
if Path('backups').resolve() not in backup.parents: raise SystemExit('Use a backup inside backups/')
name='rezeptdatenbank-restore-test';volume=name+'-uploads';envfile=Path('.env.restore')
compose=['docker','compose','-f','docker-compose.yml','-f','docker-compose.dev.yml','exec','-T','mariadb','sh','-c']
def run(args,**kwargs): return subprocess.run(args,check=True,**kwargs)
def sql(statement): run(compose+['mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"'],input=statement.encode(),stdout=subprocess.DEVNULL)
try:
 sql("DROP DATABASE IF EXISTS rezeptdatenbank_restore;CREATE DATABASE rezeptdatenbank_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;GRANT ALL ON rezeptdatenbank_restore.* TO 'rezeptdatenbank'@'%';")
 with (backup/'database.sql').open('rb') as dump:run(compose+['mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" rezeptdatenbank_restore'],stdin=dump,stdout=subprocess.DEVNULL)
 lines=(backup/'environment.env').read_text().splitlines();lines=[line.rsplit('/',1)[0]+'/rezeptdatenbank_restore' if line.startswith('DATABASE_URL=') else 'APP_ORIGIN=http://127.0.0.1:8082' if line.startswith('APP_ORIGIN=') else 'COOKIE_SECURE=false' if line.startswith('COOKIE_SECURE=') else line for line in lines]
 fd=os.open(envfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as file:file.write('\n'.join(lines)+'\n')
 run(['docker','volume','create',volume],stdout=subprocess.DEVNULL)
 run(['docker','run','--rm','--user','0','-v',volume+':/data','-v',str(backup)+':/backup:ro','--entrypoint','sh',image,'-c','tar -xzf /backup/uploads.tar.gz -C /data && chown -R 1000:1000 /data'],stdout=subprocess.DEVNULL)
 docker=['docker','run','--rm','--network','rezeptdatenbank_default','--env-file',str(envfile),'--entrypoint','node',image]
 before=json.loads(subprocess.check_output(docker+['scripts/data-state.cjs']))
 expected=json.loads((backup/'data-before.json').read_text())
 if before!=expected:raise RuntimeError('Restored SQL data differs from backup fingerprint')
 run(['docker','run','-d','--name',name,'--network','rezeptdatenbank_default','--env-file',str(envfile),'-v',volume+':/app/uploads','-p','127.0.0.1:8082:3000',image],stdout=subprocess.DEVNULL)
 for attempt in range(40):
  try:
   with urllib.request.urlopen('http://127.0.0.1:8082/api/v1/health/ready',timeout=2) as response:
    if response.status==200:break
  except Exception:time.sleep(1)
 else:raise RuntimeError('Restore instance not ready')
 after=json.loads(subprocess.check_output(docker+['scripts/data-state.cjs']))
 if after!=before:raise RuntimeError('Restore migration changed existing data')
 # An ephemeral session is inserted only into the disposable restored DB.
 source='''const {PrismaClient}=require("@prisma/client");const {randomBytes,createHash}=require("node:crypto");const db=new PrismaClient();(async()=>{const user=await db.user.findFirst({orderBy:{createdAt:"asc"}});if(!user)return console.log(JSON.stringify({empty:true}));const token=randomBytes(32).toString("hex");await db.session.create({data:{userId:user.id,tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+60000)}});const recipes=await db.recipe.findMany({where:{creatorId:user.id,deletedAt:null},select:{id:true,images:{select:{id:true,storageKey:true}}}});console.log(JSON.stringify({token,recipes}));})().finally(()=>db.$disconnect());'''
 state=json.loads(subprocess.check_output(docker+['-e',source]));checked=0
 if not state.get('empty'):
  def fetch(path):
   request=urllib.request.Request('http://127.0.0.1:8082/api/v1'+path,headers={'Cookie':'session='+state['token']})
   with urllib.request.urlopen(request,timeout=5) as response:return response.read()
  json.loads(fetch('/auth/me'))
  with tarfile.open(backup/'uploads.tar.gz') as archive:
   files={m.name.removeprefix('./'):m for m in archive.getmembers() if m.isfile()}
   for recipe in state['recipes']:
    json.loads(fetch('/recipes/'+recipe['id']))
    for picture in recipe['images']:
     actual=fetch('/recipes/'+recipe['id']+'/images/'+picture['id'])
     original=archive.extractfile(files[picture['storageKey']]).read()
     if hashlib.sha256(actual).digest()!=hashlib.sha256(original).digest():raise RuntimeError('Restored image differs')
     checked+=1
 print(json.dumps({'restored':True,'existingDataPreserved':True,'authenticatedRead':not state.get('empty'),'verifiedImages':checked}))
finally:
 subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['docker','volume','rm',volume],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 envfile.unlink(missing_ok=True)
 sql('DROP DATABASE IF EXISTS rezeptdatenbank_restore;')
