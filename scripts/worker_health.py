import os,sqlite3,time,sys
c=sqlite3.connect(os.path.join(os.getenv('DATA_DIR','/data'),'lab.sqlite3'))
r=c.execute('SELECT value FROM kv WHERE key=?',(sys.argv[1],)).fetchone()
sys.exit(0 if r and time.time()-float(r[0])<60 else 1)
