import hashlib, secrets, hmac, os, base64

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
    """
    Encrypt sensitive credentials using Authenticated Stream Cipher (CTR + HMAC-SHA256).
    Zero external C-dependency requirement, works seamlessly in any container environment.
    """
    if not val:
        return ""
    key = _get_encryption_key()
    nonce = os.urandom(16)
    data = val.encode('utf-8')
    keystream = bytearray()
    counter = 0
    while len(keystream) < len(data):
        block = hmac.new(key, nonce + counter.to_bytes(4, 'big'), hashlib.sha256).digest()
        keystream.extend(block)
        counter += 1
    ct = bytes(a ^ b for a, b in zip(data, keystream[:len(data)]))
    tag = hmac.new(key, b'AUTH:' + nonce + ct, hashlib.sha256).digest()[:16]
    return base64.b64encode(nonce + tag + ct).decode('ascii')

def decrypt_secret(enc: str) -> str:
    """Decrypt authenticated ciphertext and verify MAC integrity."""
    if not enc:
        return ""
    try:
        raw = base64.b64decode(enc.encode('ascii'))
        if len(raw) < 32:
            return ""
        nonce, tag, ct = raw[:16], raw[16:32], raw[32:]
        key = _get_encryption_key()
        expected_tag = hmac.new(key, b'AUTH:' + nonce + ct, hashlib.sha256).digest()[:16]
        if not hmac.compare_digest(tag, expected_tag):
            return ""
        keystream = bytearray()
        counter = 0
        while len(keystream) < len(ct):
            block = hmac.new(key, nonce + counter.to_bytes(4, 'big'), hashlib.sha256).digest()
            keystream.extend(block)
            counter += 1
        pt = bytes(a ^ b for a, b in zip(ct, keystream[:len(ct)]))
        return pt.decode('utf-8')
    except Exception:
        return ""

def bootstrap(c):
    email=os.getenv('ADMIN_EMAIL','admin@zupirus.local').lower()
    password=os.getenv('ADMIN_PASSWORD','')
    if not c.execute('SELECT 1 FROM users WHERE email=?',(email,)).fetchone():
        if len(password)<16: raise RuntimeError('ADMIN_PASSWORD must contain at least 16 characters')
        uid=secrets.token_hex(16)
        c.execute('INSERT INTO users VALUES(?,?,?,?)',(uid,email,password_hash(password),'admin'))

