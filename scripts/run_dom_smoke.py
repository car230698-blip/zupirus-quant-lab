import sys,subprocess,tempfile,os,time,shutil
from pathlib import Path
import httpx
root=Path(__file__).resolve().parents[1]
node_bin = shutil.which('node') or os.path.expanduser(r'~/.local/nodejs/node.exe')
if not os.path.exists(str(node_bin)):
    node_bin = 'node'
env={**os.environ,'DATA_DIR':tempfile.mkdtemp(prefix='zupirus-dom-'),'ADMIN_PASSWORD':'dom-test-password-123','COOKIE_SECURE':'false','ALLOWED_ORIGINS':'http://127.0.0.1:18082'}
processes=[]
try:
    for module,args in [('uvicorn',['app.main:app','--host','127.0.0.1','--port','18082']),('app.engine',[]),('app.research',[])]:
        processes.append(subprocess.Popen([sys.executable,'-m',module,*args],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
    with httpx.Client(trust_env=False) as c:
        for i in range(80):
            try:
                if c.get('http://127.0.0.1:18082/healthz').status_code==200:break
            except httpx.HTTPError:pass
            time.sleep(.1)
        else:raise RuntimeError('API startup timed out')
    result=subprocess.run([str(node_bin),'scripts/dom_smoke.cjs'],cwd=root,env=env,timeout=70)
    sys.exit(result.returncode)
finally:
    for p in processes:p.terminate()
    for p in processes:
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill()
