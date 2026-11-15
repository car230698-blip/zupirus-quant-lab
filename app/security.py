import hashlib, secrets, hmac, os, base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def digest(s): return hashlib.sha256(s.encode()).hexdigest()
def token(): return secrets.token_urlsafe(32)
def password_hash(value):
    salt=secrets.token_hex(16)
    return salt+':'+hashlib.scrypt(value.encode(),salt=salt.encode(),n=16384,r=8,p=1).hex()
def verify(value, stored):
    salt, expected=stored.split(':')
    actual=hashlib.scrypt(value.encode(),salt=salt.encode(),n=16384,r=8,p=1).hex()
    return hmac.compare_digest(actual,expected)

def _get_encryption_key() -> bytes:
    raw = os.getenv('ENCRYPTION_KEY', os.getenv('SECRET_KEY', 'zupirus_master_production_secret_key_2026'))
    return hashlib.sha256(raw.encode()).digest()

def encrypt_secret(val: str) -> str:
    """Encrypt sensitive trading passwords using AES-256-GCM with random 12-byte nonce."""
    if not val:
        return ""
    key = _get_encryption_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, val.encode('utf-8'), None)
    return base64.b64encode(nonce + ct).decode('ascii')

def decrypt_secret(enc: str) -> str:
    """Decrypt AES-256-GCM encrypted secrets."""
    if not enc:
        return ""
    raw = base64.b64decode(enc.encode('ascii'))
    nonce, ct = raw[:12], raw[12:]
    key = _get_encryption_key()
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ct, None).decode('utf-8')

def bootstrap(c):
    email=os.getenv('ADMIN_EMAIL','admin@zupirus.local').lower()
    password=os.getenv('ADMIN_PASSWORD','')
    if not c.execute('SELECT 1 FROM users WHERE email=?',(email,)).fetchone():
        if len(password)<16: raise RuntimeError('ADMIN_PASSWORD must contain at least 16 characters')
        uid=secrets.token_hex(16)
        c.execute('INSERT INTO users VALUES(?,?,?,?)',(uid,email,password_hash(password),'admin'))

