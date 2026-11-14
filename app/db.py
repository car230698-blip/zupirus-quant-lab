import os, sqlite3, time, json
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.getenv('DATA_DIR', ROOT / 'runtime'))
DATA.mkdir(parents=True, exist_ok=True)
DB = DATA / 'lab.sqlite3'

@contextmanager
def tx():
    c = sqlite3.connect(DB, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA busy_timeout=30000')
    try:
        c.execute('BEGIN IMMEDIATE')
        yield c
        c.commit()
    except BaseException:
        c.rollback()
        raise
    finally:
        c.close()

def init():
    c = sqlite3.connect(DB)
    c.execute('PRAGMA journal_mode=WAL')
    c.executescript('''
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','admin')));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),login TEXT NOT NULL,server TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('DEMO','REPLAY')),enabled INTEGER NOT NULL DEFAULT 0,risk REAL NOT NULL DEFAULT 0.25,max_spread REAL NOT NULL DEFAULT 0.8,max_positions INTEGER NOT NULL DEFAULT 1,max_dd REAL NOT NULL DEFAULT 10,balance REAL NOT NULL DEFAULT 10000,equity REAL NOT NULL DEFAULT 10000,peak REAL NOT NULL DEFAULT 10000,seen REAL NOT NULL DEFAULT 0,positions INTEGER NOT NULL DEFAULT 0,UNIQUE(login,server));
CREATE TABLE IF NOT EXISTS pairings(code TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),expires REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS devices(token TEXT PRIMARY KEY,account_id TEXT UNIQUE REFERENCES accounts(id));
CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY,source TEXT NOT NULL CHECK(source IN ('DEMO','REPLAY')),side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),price REAL NOT NULL,sl REAL NOT NULL,tp REAL NOT NULL,created REAL NOT NULL,expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS dispatches(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT REFERENCES accounts(id),signal_id TEXT REFERENCES signals(id),state TEXT NOT NULL DEFAULT 'queued',nonce TEXT,ticket TEXT,deal TEXT,reason TEXT,created REAL NOT NULL,updated REAL NOT NULL,UNIQUE(account_id,signal_id));
CREATE UNIQUE INDEX IF NOT EXISTS unique_deal ON dispatches(account_id,deal) WHERE deal IS NOT NULL AND deal != '';
CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY,account_id TEXT REFERENCES accounts(id),ts REAL NOT NULL,balance REAL NOT NULL,equity REAL NOT NULL);
CREATE TABLE IF NOT EXISTS quotes(id INTEGER PRIMARY KEY,source TEXT NOT NULL,ts REAL NOT NULL,bid REAL NOT NULL,ask REAL NOT NULL,UNIQUE(source,ts));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ts REAL NOT NULL,actor TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,state TEXT NOT NULL,decision INTEGER,result TEXT,error TEXT,created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS news(id TEXT PRIMARY KEY,title TEXT NOT NULL,currency TEXT NOT NULL,impact TEXT NOT NULL,ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sim_positions(dispatch_id INTEGER PRIMARY KEY REFERENCES dispatches(id),account_id TEXT REFERENCES accounts(id),side TEXT NOT NULL,entry REAL NOT NULL,sl REAL NOT NULL,tp REAL NOT NULL,lots REAL NOT NULL);
CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,until REAL NOT NULL);
''')
    c.commit(); c.close()

def audit(c, actor, event, detail):
    c.execute('INSERT INTO audit(ts,actor,event,detail) VALUES(?,?,?,?)',(time.time(),actor,event,json.dumps(detail,ensure_ascii=False)))

def setkv(c,key,value):
    c.execute('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,str(value)))
