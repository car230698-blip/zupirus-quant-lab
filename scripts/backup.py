"""Consistent SQLite online backups (run inside API container; copy output off VPS)."""
import sqlite3,os,datetime
from pathlib import Path
root=Path(os.getenv('DATA_DIR','/data')); target=root/'backups'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');target.mkdir(parents=True)
for name in ('lab.sqlite3','research.sqlite3'):
    if not (root/name).exists(): continue
    with sqlite3.connect(root/name) as source,sqlite3.connect(target/name) as dest: source.backup(dest)
print(target)
