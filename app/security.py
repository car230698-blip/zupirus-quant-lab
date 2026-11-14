import hashlib, secrets, hmac, os

def digest(s): return hashlib.sha256(s.encode()).hexdigest()
def token(): return secrets.token_urlsafe(32)
def password_hash(value):
    salt=secrets.token_hex(16)
    return salt+':'+hashlib.scrypt(value.encode(),salt=salt.encode(),n=16384,r=8,p=1).hex()
def verify(value, stored):
    salt, expected=stored.split(':')
    actual=hashlib.scrypt(value.encode(),salt=salt.encode(),n=16384,r=8,p=1).hex()
    return hmac.compare_digest(actual,expected)
def bootstrap(c):
    email=os.getenv('ADMIN_EMAIL','admin@zupirus.local').lower()
    password=os.getenv('ADMIN_PASSWORD','')
    if not c.execute('SELECT 1 FROM users WHERE email=?',(email,)).fetchone():
        if len(password)<16: raise RuntimeError('ADMIN_PASSWORD must contain at least 16 characters')
        uid=secrets.token_hex(16)
        c.execute('INSERT INTO users VALUES(?,?,?,?)',(uid,email,password_hash(password),'admin'))
        c.execute("INSERT INTO accounts(id,user_id,login,server,mode,enabled) VALUES(?,?,?,?,?,1)",(secrets.token_hex(12),uid,str(secrets.randbelow(10**12)),'ZUPIRUS-SYNTHETIC','REPLAY'))
