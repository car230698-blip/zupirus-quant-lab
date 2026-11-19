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

_EPHEMERAL_DEV_KEY = secrets.token_hex(32)


def _get_encryption_key() -> bytes:
    raw = os.getenv('ENCRYPTION_KEY') or os.getenv('SECRET_KEY')
    if not raw:
        env_name = os.getenv('APP_ENV', '').lower()
        if env_name in ('production', 'staging') and not os.getenv('PYTEST_CURRENT_TEST'):
            raise RuntimeError(f'ENCRYPTION_KEY must be configured in {env_name} environment')
        raw = _EPHEMERAL_DEV_KEY
    return hashlib.sha256(raw.encode()).digest()

def encrypt_secret(val: str) -> str:
    """
    Encrypt sensitive credentials using Authenticated Stream Cipher (CTR + HMAC-SHA256)
    with domain-separated encryption and MAC subkeys, prefixed with 'enc:'.
    """
    if not val:
        return ""
    master = _get_encryption_key()
    enc_key = hmac.new(master, b'ZUPIRUS_ENC_V2', hashlib.sha256).digest()
    mac_key = hmac.new(master, b'ZUPIRUS_MAC_V2', hashlib.sha256).digest()
    nonce = os.urandom(16)
    data = val.encode('utf-8')
    keystream = bytearray()
    counter = 0
    while len(keystream) < len(data):
        block = hmac.new(enc_key, nonce + counter.to_bytes(4, 'big'), hashlib.sha256).digest()
        keystream.extend(block)
        counter += 1
    ct = bytes(a ^ b for a, b in zip(data, keystream[:len(data)]))
    tag = hmac.new(mac_key, b'AUTH:' + nonce + ct, hashlib.sha256).digest()[:16]
    return "enc:" + base64.b64encode(nonce + tag + ct).decode('ascii')

def decrypt_secret(enc: str) -> str:
    """Decrypt authenticated ciphertext (supports v2 'enc:' prefix and legacy v1 unprefixed)."""
    if not enc:
        return ""
    try:
        is_v2 = enc.startswith("enc:")
        payload = enc[4:] if is_v2 else enc
        raw = base64.b64decode(payload.encode('ascii'))
        if len(raw) < 32:
            return ""
        nonce, tag, ct = raw[:16], raw[16:32], raw[32:]
        master = _get_encryption_key()
        if is_v2:
            enc_key = hmac.new(master, b'ZUPIRUS_ENC_V2', hashlib.sha256).digest()
            mac_key = hmac.new(master, b'ZUPIRUS_MAC_V2', hashlib.sha256).digest()
        else:
            enc_key = master
            mac_key = master
        expected_tag = hmac.new(mac_key, b'AUTH:' + nonce + ct, hashlib.sha256).digest()[:16]
        if not hmac.compare_digest(tag, expected_tag):
            return ""
        keystream = bytearray()
        counter = 0
        while len(keystream) < len(ct):
            block = hmac.new(enc_key, nonce + counter.to_bytes(4, 'big'), hashlib.sha256).digest()
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

    if os.getenv('APP_ENV', 'dev').lower() != 'production':
        trader_email = 'trader@zupirus.local'
        trader_pass = os.getenv('DEMO_TRADER_PASSWORD', 'quant-access-2026')
        if not c.execute('SELECT 1 FROM users WHERE email=?', (trader_email,)).fetchone():
            t_uid = secrets.token_hex(16)
            c.execute('INSERT INTO users VALUES(?,?,?,?)', (t_uid, trader_email, password_hash(trader_pass), 'customer'))

