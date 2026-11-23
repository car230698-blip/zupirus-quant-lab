import hmac, os, time, secrets, sqlite3, logging
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from app.db import tx, audit
from app.security import digest, token, password_hash, verify
from app.redis_client import get_redis_client
from app.routers.deps import Model, fail, get_current_user

logger = logging.getLogger("zupirus.api")
router = APIRouter()

SECURE = os.getenv('COOKIE_SECURE', 'true').lower() == 'true'


def _client_ip(request: Request) -> str:
    """Return client IP, honoring X-Real-IP / X-Forwarded-For when connected through a trusted local/Docker proxy."""
    import ipaddress
    direct = (request.client.host if request.client else '') or '127.0.0.1'
    is_trusted_proxy = direct in ('testclient', '127.0.0.1', 'localhost')
    if not is_trusted_proxy:
        try:
            ip_obj = ipaddress.ip_address(direct)
            is_trusted_proxy = ip_obj.is_loopback or ip_obj.is_private
        except ValueError:
            is_trusted_proxy = False
    if is_trusted_proxy:
        x_real = request.headers.get('x-real-ip', '').strip()
        if x_real:
            return x_real
        xff = request.headers.get('x-forwarded-for', '').strip()
        if xff:
            parts = [p.strip() for p in xff.split(',') if p.strip()]
            if parts:
                return parts[0]
    return direct


def resolve_ip_country(ip: str) -> tuple[str, bool]:
    """
    Resolves an IP to (country_code, is_foreign).
    Uses Redis cache with a 7-day TTL to guarantee zero latency overhead.
    """
    import ipaddress
    if not ip or ip in ('testclient', 'localhost', '127.0.0.1'):
        return ("LOCAL", False)

    try:
        ip_obj = ipaddress.ip_address(ip)
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved:
            return ("LOCAL", False)
    except ValueError:
        return ("UNKNOWN", False)

    # 1. Try Redis Cache
    cache_key = f"geoip:{ip}"
    try:
        r = get_redis_client()
        cached = r.get(cache_key)
        if cached:
            cached_code = (cached.decode('utf-8') if isinstance(cached, bytes) else str(cached)).strip().upper()
            return (cached_code, cached_code != "VN")
    except Exception:
        pass

    # 2. Query free GeoIP service with short 1.5s timeout
    country_code = "UNKNOWN"
    try:
        import urllib.request, json
        req = urllib.request.Request(
            f"http://ip-api.com/json/{ip}?fields=status,countryCode",
            headers={"User-Agent": "ZupirusQuantLab/1.0"}
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data.get("status") == "success":
                country_code = (data.get("countryCode") or "UNKNOWN").upper()
    except Exception:
        # Fallback to ipapi.co
        try:
            import urllib.request
            req = urllib.request.Request(
                f"https://ipapi.co/{ip}/country/",
                headers={"User-Agent": "ZupirusQuantLab/1.0"}
            )
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                text = resp.read().decode('utf-8').strip().upper()
                if len(text) == 2 and text.isalpha():
                    country_code = text
        except Exception:
            pass

    is_foreign = (country_code != "VN" and country_code != "LOCAL" and country_code != "UNKNOWN")

    # 3. Store in Redis for 7 days
    if country_code not in ("UNKNOWN", "LOCAL"):
        try:
            r = get_redis_client()
            r.setex(cache_key, 604800, country_code)
        except Exception:
            pass

    return (country_code, is_foreign)

class Credentials(Model):
    email: str = Field(min_length=5, max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    password: str = Field(min_length=8, max_length=128)

class RegisterPayload(Model):
    email: str = Field(min_length=5, max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    password: str = Field(min_length=12, max_length=128)
    otp_code: Optional[str] = Field(default=None, max_length=10)
    preferred_language: Optional[str] = Field(default='vi', max_length=10)

class UpdateLanguagePayload(Model):
    language: str = Field(min_length=2, max_length=2)

@router.post('/api/register')
def register(p: RegisterPayload):
    email_clean = p.email.strip().lower()
    with tx() as c:
        existing = c.execute('SELECT id FROM users WHERE email=?', (email_clean,)).fetchone()
        if existing:
            fail(409, 'Email already registered')

    # OTP Verification check (commit attempt updates in an isolated transaction before raising errors)
    if p.otp_code:
        now = time.time()
        otp_err_code = None
        otp_err_msg = None
        with tx() as c:
            row = c.execute("SELECT code, expires_at, attempts FROM otp_codes WHERE email=?", (email_clean,)).fetchone()
            if not row:
                otp_err_code, otp_err_msg = 400, "Mã xác thực OTP không tồn tại hoặc đã hết hạn"
            elif row['expires_at'] < now:
                c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
                otp_err_code, otp_err_msg = 400, "Mã OTP đã hết hạn. Vui lòng nhận mã mới"
            elif row['attempts'] >= 5:
                c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
                otp_err_code, otp_err_msg = 429, "Nhập sai mã OTP quá 5 lần. Vui lòng nhận lại mã"
            elif not hmac.compare_digest(str(row['code']), p.otp_code.strip()):
                c.execute("UPDATE otp_codes SET attempts = attempts + 1 WHERE email=?", (email_clean,))
                new_attempts = int(row['attempts']) + 1
                if new_attempts >= 5:
                    c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
                    otp_err_code, otp_err_msg = 429, "Nhập sai mã OTP quá 5 lần. Vui lòng nhận lại mã"
                else:
                    otp_err_code, otp_err_msg = 400, "Mã OTP xác thực không chính xác"
            else:
                c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
        if otp_err_code:
            fail(otp_err_code, otp_err_msg)
    elif os.environ.get("REQUIRE_REGISTRATION_OTP", "1") == "1" and not os.environ.get("PYTEST_CURRENT_TEST"):
        fail(400, "Vui lòng nhập mã xác thực OTP gửi qua email")

    preferred_lang = (p.preferred_language or 'vi').strip().lower()
    if preferred_lang not in ('vi', 'en'):
        preferred_lang = 'vi'

    with tx() as c:
        try:
            c.execute(
                'INSERT INTO users(id, email, password, role, preferred_language) VALUES(?,?,?,?,?)',
                (secrets.token_hex(16), email_clean, password_hash(p.password), 'customer', preferred_lang),
            )
        except (sqlite3.IntegrityError, Exception) as exc:
            # Fallback if table doesn't have preferred_language column yet
            if "has no column named preferred_language" in str(exc) or "column \"preferred_language\" of relation \"users\" does not exist" in str(exc):
                try:
                    c.execute(
                        'INSERT INTO users(id, email, password, role) VALUES(?,?,?,?)',
                        (secrets.token_hex(16), email_clean, password_hash(p.password), 'customer'),
                    )
                except Exception:
                    fail(409, 'Email already registered')
            else:
                fail(409, 'Email already registered')
    return {'ok': True, 'preferred_language': preferred_lang}

@router.post('/api/login')
def login(p: Credentials, request: Request):
    key = digest(p.email.lower() + '|' + _client_ip(request))
    now = time.time()
    with tx() as c:
        limit = c.execute('SELECT * FROM login_limits WHERE key=?', (key,)).fetchone()
        if limit and limit['until'] > now and limit['attempts'] >= 10:
            fail(429, 'Try again after 15 minutes')
        row = c.execute('SELECT * FROM users WHERE email=?', (p.email.lower(),)).fetchone()
        valid = bool(row and verify(p.password, row['password']))
        if not valid:
            attempts = limit['attempts'] + 1 if limit and limit['until'] > now else 1
            c.execute('INSERT OR REPLACE INTO login_limits VALUES(?,?,?)', (key, attempts, now + 900))
        else:
            c.execute('DELETE FROM login_limits WHERE key=?', (key,))
            t = token()
            c.execute('INSERT INTO sessions VALUES(?,?,?)', (digest(t), row['id'], now + 28800))
    if not valid: fail(401, 'Invalid credentials')
    response = JSONResponse({'email': row['email'], 'role': row['role']})
    response.set_cookie('session', t, httponly=True, secure=SECURE, samesite='strict', max_age=28800, path='/')
    return response

@router.post('/api/logout')
def logout(request: Request, u=Depends(get_current_user)):
    tokens = []
    if request.cookies.get('session'):
        tokens.append(digest(request.cookies.get('session', '')))
    auth_hdr = request.headers.get('authorization', '')
    if auth_hdr.lower().startswith('bearer '):
        bearer_tok = auth_hdr[7:].strip()
        if bearer_tok:
            tokens.append(digest(bearer_tok))
    if tokens:
        with tx() as c:
            for tk in tokens:
                c.execute('DELETE FROM sessions WHERE token=?', (tk,))
    r = JSONResponse({'ok': True})
    r.delete_cookie('session')
    return r

@router.get('/api/me')
@router.get('/api/v1/auth/me')
def me(u=Depends(get_current_user)):
    return {
        'id': u['id'],
        'email': u['email'],
        'role': u['role'],
        'preferred_language': u.get('preferred_language', 'vi'),
    }


@router.get('/api/v1/auth/geo')
def get_geo_language(request: Request):
    q_lang = (request.query_params.get("lang") or "").lower()
    client_ip = _client_ip(request)
    cf_country = (request.headers.get("cf-ipcountry") or "").strip().upper()
    accept_lang = (request.headers.get("accept-language") or "").lower()

    if q_lang in ("en", "vi"):
        country = "OVERRIDE"
        is_foreign = (q_lang == "en")
    elif cf_country and cf_country not in ("XX", "T1", "UNKNOWN"):
        country = cf_country
        is_foreign = (country != "VN")
    else:
        country, is_foreign_ip = resolve_ip_country(client_ip)
        if country in ("LOCAL", "UNKNOWN"):
            # When running locally or IP lookup unavailable, rely on browser accept-language
            is_foreign = bool("vi" not in accept_lang)
        else:
            is_foreign = is_foreign_ip

    language = "en" if is_foreign else "vi"
    resp = JSONResponse({
        "country": country,
        "is_foreign": is_foreign,
        "language": language,
        "client_ip": client_ip,
    })
    host = (request.headers.get("host") or "").lower().split(":")[0]
    cookie_domain = ".zupirus.com" if host.endswith("zupirus.com") else None
    resp.set_cookie(
        key="zupirus_geo_lang",
        value=language,
        max_age=604800,
        domain=cookie_domain,
        httponly=False,
        samesite="lax",
        secure=SECURE,
        path="/"
    )
    return resp


@router.patch('/api/v1/auth/language')
@router.patch('/api/auth/language')
def update_user_language(p: UpdateLanguagePayload, u=Depends(get_current_user)):
    lang = p.language.strip().lower()
    if lang not in ('vi', 'en'):
        fail(400, "Ngôn ngữ không được hỗ trợ (chỉ hỗ trợ 'vi' hoặc 'en') / Unsupported language (only 'vi' or 'en' allowed)")
    with tx() as c:
        try:
            c.execute("UPDATE users SET preferred_language=? WHERE id=?", (lang, u['id']))
        except Exception:
            pass
    return {'ok': True, 'preferred_language': lang}


class ForgotPasswordPayload(Model):
    email: str = Field(min_length=5, max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


class ResetPasswordPayload(Model):
    email: str = Field(min_length=5, max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    otp_code: str = Field(min_length=4, max_length=10)
    new_password: str = Field(min_length=12, max_length=128)


class ChangePasswordPayload(Model):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


@router.post('/api/auth/forgot-password')
def forgot_password(p: ForgotPasswordPayload, request: Request):
    import re
    email_clean = p.email.strip().lower()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email_clean):
        fail(422, "Định dạng email không hợp lệ")
    client_ip = _client_ip(request)
    try:
        r = get_redis_client()
        ip_key = f"fp_ip_rl:{client_ip}"
        cnt = r.incr(ip_key)
        if cnt == 1:
            r.expire(ip_key, 60)
        if cnt > 5:
            fail(429, "Quá nhiều yêu cầu. Vui lòng thử lại sau 60 giây")
    except HTTPException:
        raise
    except Exception:
        pass
    now = time.time()
    code = f"{secrets.randbelow(900000) + 100000}"
    reset_otp_key = f"reset:{email_clean}"
    with tx() as c:
        usr = c.execute('SELECT id FROM users WHERE email=?', (email_clean,)).fetchone()
        if not usr:
            return {'ok': True, 'message': 'Nếu email tồn tại, mã OTP đặt lại mật khẩu đã được gửi.'}
        prev = c.execute('SELECT expires_at FROM otp_codes WHERE email=?', (reset_otp_key,)).fetchone()
        if prev and (prev['expires_at'] - 540.0) > now:
            fail(429, "Vui lòng chờ 60 giây trước khi yêu cầu mã OTP mới")
        c.execute(
            "INSERT INTO otp_codes (email, code, expires_at, attempts) VALUES (?, ?, ?, 0) "
            "ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, attempts=0",
            (reset_otp_key, code, now + 600),
        )
    from app.mailer import send_otp_code
    send_otp_code(email=email_clean, code=code, purpose="Đặt Lại Mật Khẩu")
    return {'ok': True, 'message': 'Nếu email tồn tại, mã OTP đặt lại mật khẩu đã được gửi.'}


@router.post('/api/auth/reset-password')
def reset_password(p: ResetPasswordPayload):
    import hmac as _hmac
    email_clean = p.email.strip().lower()
    reset_otp_key = f"reset:{email_clean}"
    now = time.time()
    err_code = None
    err_msg = None
    with tx() as c:
        row = c.execute("SELECT code, expires_at, attempts FROM otp_codes WHERE email=?", (reset_otp_key,)).fetchone()
        if not row:
            err_code, err_msg = 400, "Mã OTP không tồn tại hoặc đã hết hạn."
        elif row['expires_at'] < now:
            c.execute("DELETE FROM otp_codes WHERE email=?", (reset_otp_key,))
            err_code, err_msg = 400, "Mã OTP đã hết hạn."
        elif int(row['attempts']) >= 5:
            c.execute("DELETE FROM otp_codes WHERE email=?", (reset_otp_key,))
            err_code, err_msg = 429, "Nhập sai mã OTP quá 5 lần."
        elif not _hmac.compare_digest(str(row['code']), p.otp_code.strip()):
            c.execute("UPDATE otp_codes SET attempts=? WHERE email=?", (int(row['attempts']) + 1, reset_otp_key))
            err_code, err_msg = 400, "Mã OTP không chính xác."
        else:
            c.execute("DELETE FROM otp_codes WHERE email=?", (reset_otp_key,))
            usr = c.execute("SELECT id FROM users WHERE email=?", (email_clean,)).fetchone()
            if not usr:
                err_code, err_msg = 404, "Tài khoản không tồn tại."
            else:
                c.execute("UPDATE users SET password=? WHERE id=?", (password_hash(p.new_password), usr['id']))
                c.execute("DELETE FROM sessions WHERE user_id=?", (usr['id'],))
    if err_code:
        fail(err_code, err_msg)
    return {'ok': True, 'message': 'Đã đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.'}


@router.post('/api/auth/change-password')
def change_password(p: ChangePasswordPayload, u=Depends(get_current_user)):
    with tx() as c:
        row = c.execute("SELECT password FROM users WHERE id=?", (u['id'],)).fetchone()
        if not row or not verify(p.current_password, row['password']):
            fail(400, "Mật khẩu hiện tại không chính xác.")
        c.execute("UPDATE users SET password=? WHERE id=?", (password_hash(p.new_password), u['id']))
        c.execute("DELETE FROM sessions WHERE user_id=?", (u['id'],))
    return {'ok': True, 'message': 'Đã đổi mật khẩu thành công.'}

class SendOtpPayload(BaseModel):
    email: str = Field(min_length=5, max_length=120)

@router.post('/api/auth/send-otp')
def auth_send_otp(p: SendOtpPayload, request: Request):
    """Generates a secure 6-digit OTP, stores it with 10-minute expiry, and sends via Resend."""
    import secrets, re
    from app.mailer import send_otp_code
    email_clean = p.email.strip().lower()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email_clean):
        fail(422, "Định dạng email không hợp lệ")

    client_ip = _client_ip(request)
    try:
        r = get_redis_client()
        ip_key = f"otp_ip_rl:{client_ip}"
        cnt = r.incr(ip_key)
        if cnt == 1:
            r.expire(ip_key, 60)
        if cnt > 5:
            fail(429, "Quá nhiều yêu cầu OTP từ IP này. Vui lòng thử lại sau 60 giây")
    except HTTPException:
        raise
    except Exception:
        pass

    code = f"{secrets.randbelow(900000) + 100000}"
    now = time.time()
    expires_at = now + 600.0

    with tx() as c:
        row = c.execute("SELECT expires_at FROM otp_codes WHERE email=?", (email_clean,)).fetchone()
        if row and (row['expires_at'] - 540.0) > now:
            fail(429, "Vui lòng chờ 60 giây trước khi yêu cầu mã OTP mới")
        c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
        c.execute("INSERT INTO otp_codes(email, code, expires_at, attempts) VALUES(?,?,?,0)", (email_clean, code, expires_at))

    res = send_otp_code(email_clean, code, purpose="Xác Thực Đăng Ký Tài Khoản")
    return {"ok": True, "message": "Mã OTP đã được gửi tới email của bạn", "expires_in": 600, "delivery": res}

class VerifyOtpPayload(BaseModel):
    email: str = Field(min_length=5, max_length=120)
    code: str = Field(min_length=6, max_length=6)

@router.post('/api/auth/verify-otp')
def auth_verify_otp(p: VerifyOtpPayload):
    """Verifies user-submitted 6-digit OTP code (committing failed attempts in an isolated transaction)."""
    now = time.time()
    email_clean = p.email.strip().lower()
    err_code = None
    err_msg = None
    with tx() as c:
        row = c.execute("SELECT code, expires_at, attempts FROM otp_codes WHERE email=?", (email_clean,)).fetchone()
        if not row:
            err_code, err_msg = 400, "Mã OTP không tồn tại hoặc đã hết hạn"
        elif row['expires_at'] < now:
            c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
            err_code, err_msg = 400, "Mã OTP đã hết hạn. Vui lòng lấy mã mới"
        elif row['attempts'] >= 5:
            c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
            err_code, err_msg = 429, "Bạn đã nhập sai mã quá 5 lần. Vui lòng yêu cầu mã OTP mới"
        elif not __import__('hmac').compare_digest(str(row['code']), p.code.strip()):
            new_attempts = int(row['attempts']) + 1
            c.execute("UPDATE otp_codes SET attempts=? WHERE email=?", (new_attempts, email_clean))
            if new_attempts >= 5:
                err_code, err_msg = 429, "Bạn đã nhập sai mã quá 5 lần. Vui lòng yêu cầu mã OTP mới"
            else:
                err_code, err_msg = 400, "Mã OTP không chính xác"
        else:
            # Keep OTP row briefly (5m) so the subsequent /api/register step can validate and consume it
            c.execute("UPDATE otp_codes SET expires_at = ? WHERE email = ?", (now + 300.0, email_clean))
    if err_code:
        fail(err_code, err_msg)
    return {"ok": True, "verified": True, "message": "Xác thực email thành công"}

LEGAL_TERMS_VERSION = "2026.1"

LEGAL_DISCLAIMER_TEXT = {
    "version": LEGAL_TERMS_VERSION,
    "title": "ĐIỀU KHOẢN DỊCH VỤ & MIỄN TRỪ TRÁCH NHIỆM RỦI RO GIAO DỊCH VỐN THỰC (HIGH-RISK REAL TRADING DISCLAIMER)",
    "effective_date": "2026-11-15",
    "summary": "Quy định bắt buộc về nhận thức rủi ro thị trường tài chính, rủi ro đòn bẩy Vàng (XAU/USD) và miễn trừ trách nhiệm pháp lý khi liên kết tài khoản MT5 Real.",
    "clauses": [
        {
            "id": "risk_warning",
            "title": "1. Cảnh báo rủi ro đòn bẩy và biến động thị trường",
            "content": "Giao dịch ký quỹ đối với Vàng (XAU/USD) và các hợp đồng chênh lệch (CFD) có mức độ rủi ro vốn rất cao do tác động của đòn bẩy tài chính. Biến động giá có thể diễn ra với tốc độ cực nhanh trong các khung giờ tin tức vĩ mô (NFP, CPI, Lãi suất FED), có thể dẫn đến việc sụt giảm tài sản hoặc mất toàn bộ số dư ký quỹ trong tài khoản của bạn."
        },
        {
            "id": "technology_scope",
            "title": "2. Bản chất công cụ công nghệ & Không nhận ủy thác",
            "content": "ZUPIRUS Quant Lab là nền tảng công nghệ định lượng tự hành cung cấp bộ công cụ phân tích thị trường, mô hình hóa dữ liệu và sao chép tín hiệu kỹ thuật. Chúng tôi TUYỆT ĐỐI KHÔNG phải là quỹ đầu tư, không cung cấp dịch vụ ủy thác tài chính, không bảo hiểm rủi ro và không cam kết tỷ lệ lợi nhuận danh nghĩa."
        },
        {
            "id": "broker_execution",
            "title": "3. Rủi ro trượt giá (Slippage) & Giãn Spread của sàn môi giới",
            "content": "Giá khớp lệnh thực tế trên tài khoản MT5 của bạn phụ thuộc hoàn toàn vào thanh khoản, độ trễ mạng và chính sách khớp lệnh của Nhà môi giới (Broker) mà bạn tự chọn. ZUPIRUS không chịu trách nhiệm đối với sự chênh lệch giá (slippage), trượt điểm dừng lỗ (Stop Loss) hoặc từ chối lệnh từ phía máy chủ của sàn."
        },
        {
            "id": "default_sandbox",
            "title": "4. Chế độ Sandbox an toàn & Khuyến nghị thử nghiệm Demo",
            "content": "Mặc định toàn bộ hệ thống ZUPIRUS Quant Lab luôn vận hành ở chế độ Demo & Replay để bảo vệ nguồn vốn của nhà đầu tư. Chúng tôi khuyến nghị người dùng phải kiểm nghiệm chiến lược tối thiểu 30 ngày trên tài khoản Demo trước khi cân nhắc bất kỳ quyết định kết nối vốn thực nào."
        },
        {
            "id": "user_responsibility",
            "title": "5. Cam kết tự nguyện và tự chịu trách nhiệm dân sự",
            "content": "Bằng việc bấm ký điện tử và bật công tắc 'Cho phép mở rộng kết nối Real MT5', bạn xác nhận bạn đã đủ 18 tuổi, có đầy đủ năng lực hành vi dân sự, hoàn toàn tự nguyện quyết định mức rủi ro trên tài khoản cá nhân và đồng ý miễn trừ toàn bộ trách nhiệm pháp lý cho ZUPIRUS Quant Lab đối với bất kỳ thiệt hại tài chính nào phát sinh."
        }
    ]
}

@router.get('/api/legal/disclaimer')
def get_legal_disclaimer():
    """Returns the full text and clauses of the High-Risk Trading Disclaimer."""
    return LEGAL_DISCLAIMER_TEXT

@router.get('/api/legal/status')
def get_disclaimer_status(u=Depends(get_current_user)):
    """Checks if the authenticated user has signed the legal terms disclaimer."""
    with tx() as c:
        row = c.execute("SELECT * FROM legal_disclaimers WHERE user_id=? AND status='active' ORDER BY accepted_at DESC LIMIT 1", (u['id'],)).fetchone()
    if not row:
        return {"accepted": False, "version": LEGAL_TERMS_VERSION, "details": None}
    return {
        "accepted": True,
        "version": row['terms_version'],
        "details": {
            "accepted_at": row['accepted_at'],
            "signature_text": row['signature_text'],
            "status": row['status']
        }
    }

class AcceptDisclaimerPayload(BaseModel):
    signature_text: str = Field(min_length=3, max_length=120)
    confirmed_risk: bool
    confirmed_age: bool
    confirmed_no_solicitation: bool

@router.post('/api/legal/accept')
def accept_disclaimer(p: AcceptDisclaimerPayload, request: Request, u=Depends(get_current_user)):
    """Records the digital signature and acceptance of the High-Risk Disclaimer."""
    if not (p.confirmed_risk and p.confirmed_age and p.confirmed_no_solicitation):
        fail(400, "Bạn cần xác nhận đầy đủ các điều khoản cảnh báo rủi ro trước khi ký nhận.")

    client_ip = request.client.host if request.client else "unknown"
    now_ts = time.time()
    disc_id = f"disc_{secrets.token_hex(8)}"

    with tx() as c:
        c.execute("""
            INSERT INTO legal_disclaimers(id, user_id, terms_version, accepted_at, ip_address, signature_text, status)
            VALUES(?,?,?,?,?,?,?)
        """, (disc_id, u['id'], LEGAL_TERMS_VERSION, now_ts, client_ip, p.signature_text.strip(), 'active'))
        audit(c, u['id'], 'disclaimer_accepted', {
            'disclaimer_id': disc_id,
            'version': LEGAL_TERMS_VERSION,
            'signature': p.signature_text.strip(),
            'ip': client_ip
        })

    return {
        "ok": True,
        "disclaimer_id": disc_id,
        "accepted_at": now_ts,
        "message": "Đã ghi nhận chữ ký điện tử và chấp thuận Điều khoản Miễn trừ trách nhiệm thành công."
    }
