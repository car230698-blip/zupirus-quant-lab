"""Static packaging checks; explicitly not a Docker runtime test."""
from pathlib import Path
import yaml,ast,subprocess
root=Path(__file__).resolve().parents[1]
compose=yaml.safe_load((root/'compose.yaml').read_text())
assert set(('api','execution','research','proxy','tests'))<=set(compose['services'])
assert compose['services']['api']['ports']==['127.0.0.1:8080:8000']
for service in ('api','execution','research'):
    s=compose['services'][service]
    assert s['healthcheck'] and 'lab_data:/data' in s['volumes'] and s['read_only']
assert 'public' in compose['services']['proxy']['profiles']
assert 'zupirus.com {' in (root/'Caddyfile').read_text() and 'adm.zupirus.com {' in (root/'Caddyfile').read_text()
assert 'ALLOW_REAL' not in (root/'.env.example').read_text()
for p in root.glob('app/*.py'):ast.parse(p.read_text())
for p in root.glob('scripts/*.sh'):
    import shutil
    if shutil.which('bash'):
        subprocess.run(['bash','-n',str(p)],check=True)
node_bin = shutil.which('node') or r'C:\Users\hcm236\.local\nodejs\node.exe'
if shutil.which(node_bin) or Path(node_bin).exists():
    subprocess.run([node_bin, '--check', str(root / 'web/app.js')], check=True)
assert 'app app' in (root/'Dockerfile').read_text()
print('PASS: Compose YAML static structure, shared durable volume, healthchecks, loopback bind, public domain routes, shell syntax, Python AST, JavaScript syntax, Direct Cloud MetaApi verified. Docker runtime/build NOT tested by this script.')
