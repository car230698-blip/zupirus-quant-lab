"""Actual three-process startup/restart smoke, usable when Docker is unavailable."""
import os,sys,tempfile,subprocess,time,json
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[1]
env={**os.environ,'DATA_DIR':tempfile.mkdtemp(prefix='zupirus-smoke-'),'ADMIN_PASSWORD':'local-smoke-password-123','COOKIE_SECURE':'false','ALLOWED_ORIGINS':'http://localhost:8080'}
procs=[]
def start(module,args=()):
    p=subprocess.Popen([sys.executable,'-m',module,*args],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);procs.append(p);return p

def poll(fn,seconds=25):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        try:
            value=fn()
            if value:return value
        except (httpx.HTTPError,KeyError,IndexError):pass
        time.sleep(.25)
    raise AssertionError('Timeout waiting for condition')
try:
    start('uvicorn',('app.main:app','--host','127.0.0.1','--port','18080'))
    execution=start('app.engine');worker=start('app.research')
    with httpx.Client(trust_env=False,base_url='http://127.0.0.1:18080',headers={'X-Zupirus':'1'}) as c:
        poll(lambda:c.get('/healthz').status_code==200)
        c.post('/api/login',json={'email':'admin@zupirus.local','password':'local-smoke-password-123'}).raise_for_status()
        poll(lambda:len(c.get('/api/dashboard').json()['series'])>=2)
        jid=c.post('/api/admin/research').json()['id']
        def job():return next(j for j in c.get('/api/admin/monitor').json()['jobs'] if j['id']==jid)
        poll(lambda:job()['state']=='waiting_approval')
        before=float(c.get('/api/dashboard').json()['health']['execution_heartbeat'])
        worker.terminate();worker.wait(timeout=10)
        poll(lambda:float(c.get('/api/dashboard').json()['health']['execution_heartbeat'])>before)
        worker=start('app.research')
        c.post('/api/admin/research/'+jid+'/decision',json={'approved':True}).raise_for_status()
        poll(lambda:job()['state']=='completed')
        execution.terminate();execution.wait(timeout=10)
        count=len(c.get('/api/dashboard').json()['series']);execution=start('app.engine')
        poll(lambda:len(c.get('/api/dashboard').json()['series'])>count)
        print('PASS: actual API + Execution + Research processes; Replay snapshots; durable interrupt/resume across Research restart; Execution continues while Research stopped; Execution restart preserves data.')
finally:
    for p in procs:
        if p.poll() is None:p.terminate()
    for p in procs:
        try:p.wait(timeout=10)
        except subprocess.TimeoutExpired:p.kill()
