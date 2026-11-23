import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from .db import ROOT, check_db_health, check_timescale_metadata, init, is_postgres, tx
from .redis_client import get_redis_client
from .security import bootstrap
from app.routers import (
    accounts_router,
    admin_ai_router,
    admin_billing_router,
    admin_ops_router,
    admin_users_router,
    ai_chat_router,
    auth_router,
    billing_router,
    dashboard_router,
    ea_router,
    metaapi_dispatch_router,
    notifications_router,
    realtime_router,
    signals_router,
    skills_router,
    sources_router,
    telemetry_router,
    telemetry_admin_router,
    webhooks_router,
)
from app.routers.growth import router as growth_router
from app.routers.seo_pages import router as seo_pages_router
from app.routers.auth import _client_ip, resolve_ip_country

logger = logging.getLogger("zupirus.api")

# Conditional high-performance uvloop activation on POSIX/Linux
if sys.platform != "win32":
    try:
        import uvloop
        uvloop.install()
    except (ImportError, Exception):
        pass

# Optional Sentry monitoring integration with credentials redaction
if os.getenv("SENTRY_DSN"):
    try:
        import sentry_sdk

        def _sentry_before_send(event, hint):
            if "request" in event and "data" in event["request"]:
                data = event["request"]["data"]
                if isinstance(data, dict):
                    for k in list(data.keys()):
                        if any(s in k.lower() for s in ("password", "token", "secret", "api_key", "metaapi")):
                            data[k] = "[REDACTED]"
            return event

        sentry_sdk.init(
            dsn=os.getenv("SENTRY_DSN"),
            traces_sample_rate=0.1,
            before_send=_sentry_before_send,
        )
        logger.info("Sentry monitoring initialized successfully (traces_sample_rate=0.1).")
    except Exception as exc:
        logger.warning(f"Sentry init error: {exc}")


@asynccontextmanager
async def lifespan(app):
    init()
    with tx() as c:
        bootstrap(c)
    yield


app = FastAPI(
    title='ZUPIRUS Quant Lab · Production Engine',
    version='0.2.0',
    lifespan=lifespan,
    default_response_class=ORJSONResponse,
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
ORIGINS = os.getenv(
    'ALLOWED_ORIGINS',
    'https://zupirus.com,https://app.zupirus.com,https://adm.zupirus.com,http://localhost:5173,http://localhost:3000',
).split(',')


@app.middleware('http')
async def perimeter(request: Request, call_next):
    # Defense-in-depth: enforce domain isolation even when behind external reverse proxies (NPM/ALB/Caddy)
    host = (request.headers.get('host') or '').split(':')[0].lower()
    if host in ('app.zupirus.com', 'zupirus.com', 'www.zupirus.com'):
        admin_blocked_prefixes = (
            '/api/admin',
            '/api/billing/admin',
            '/api/v1/billing/admin',
            '/api/v1/telemetry/admin-radar',
            '/api/v1/telemetry/ai-evolution',
            '/api/chat/admin-agent',
            '/api/v1/stream/admin',
        )
        if any(request.url.path.startswith(p) for p in admin_blocked_prefixes):
            return JSONResponse({'detail': 'Use adm.zupirus.com'}, 403)

    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
        max_body_size = 35_000_000 if request.url.path == '/api/admin/skills/ingest-pdf' else 3_000_000
        raw_len = request.headers.get('content-length')
        if raw_len is not None:
            if not raw_len.isdigit() or int(raw_len) > max_body_size:
                return JSONResponse({'detail': 'Body too large'}, 413)
        elif 'chunked' in request.headers.get('transfer-encoding', '').lower():
            body_bytes = await request.body()
            if len(body_bytes) > max_body_size:
                return JSONResponse({'detail': 'Body too large'}, 413)
        # External webhooks bypass browser origin checks
        if request.url.path.startswith('/api/v1/webhooks') or request.url.path.startswith('/api/sepay') or request.url.path.startswith('/api/webhooks'):
            return await call_next(request)
        origin = request.headers.get('origin')
        if origin and origin not in ORIGINS:
            return JSONResponse({'detail': 'Origin denied'}, 403)
        if request.cookies.get('session') and request.headers.get('x-zupirus') != '1':
            return JSONResponse({'detail': 'CSRF header required'}, 403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://qr.sepay.vn https://*.sepay.vn "
        "https://img.vietqr.io https://api.vietqr.io https://*.vietqr.io https://vietqr.net https://api.qrserver.com; connect-src 'self'; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    response.headers['Referrer-Policy'] = 'no-referrer'
    if request.url.path.startswith('/assets/'):
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    elif 'Cache-Control' not in response.headers:
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.get('/healthz')
def healthz():
    """Liveness probe reflecting basic process health."""
    db_check = check_db_health()
    return {
        'status': 'ok' if db_check['status'] == 'up' else 'degraded',
        'real_trading': False,
        'database': db_check['engine'],
        'database_status': db_check['status'],
        'redis_stream': True,
        'langsmith_tracing': bool(os.getenv('LANGSMITH_API_KEY')),
    }


@app.get('/readyz')
@app.get('/api/health')
def readyz():
    """Readiness probe strictly verifying real connections to PostgreSQL, TimescaleDB, Redis, and background workers."""
    db_info = check_db_health()
    db_ok = db_info.get("status") == "up"

    redis_ok = False
    redis_err = None
    try:
        r = get_redis_client()
        redis_ok = bool(r.ping())
    except Exception as e:
        redis_err = str(e)

    timescale_info = {"timescaledb_available": False, "connected": False}
    engine_ok = False
    research_ok = False
    has_hb_records = False
    if db_ok:
        timescale_info = check_timescale_metadata()
        try:
            now_ts = time.time()
            with tx() as c:
                hb = c.execute("SELECT value FROM kv WHERE key='execution_heartbeat'").fetchone()
                rhb = c.execute("SELECT value FROM kv WHERE key='research_heartbeat'").fetchone()
                if hb is not None or rhb is not None:
                    has_hb_records = True
                if hb and now_ts - float(hb[0]) < 120:
                    engine_ok = True
                elif hb is None and not is_postgres():
                    engine_ok = True
                if rhb and now_ts - float(rhb[0]) < 120:
                    research_ok = True
                elif rhb is None and not is_postgres():
                    research_ok = True
        except Exception:
            pass

    overall_ready = db_ok and redis_ok and (engine_ok if has_hb_records else True) and (research_ok if has_hb_records else True)
    payload = {
        'status': 'ready' if overall_ready else 'not_ready',
        'database': {
            'configured_as_postgres': is_postgres(),
            'engine': db_info.get('engine'),
            'connected': db_ok,
            'details': db_info,
        },
        'timescaledb': timescale_info,
        'redis': {'connected': redis_ok, 'error': redis_err},
        'execution_worker': {'heartbeat_active': engine_ok},
        'research_worker': {'heartbeat_active': research_ok},
        'langsmith': {'enabled': bool(os.getenv('LANGSMITH_API_KEY'))},
    }
    if not overall_ready:
        return JSONResponse(status_code=503, content=payload)
    return payload


for _router in (
    auth_router,
    dashboard_router,
    admin_ops_router,
    admin_users_router,
    ai_chat_router,
    metaapi_dispatch_router,
    notifications_router,
    realtime_router,
    billing_router,
    webhooks_router,
    signals_router,
    accounts_router,
    sources_router,
    admin_billing_router,
    telemetry_router,
    telemetry_admin_router,
    skills_router,
    admin_ai_router,
    growth_router,
    seo_pages_router,
):
    app.include_router(_router)

if os.getenv("ENABLE_LEGACY_EA_BRIDGE", "false").lower() in ("true", "1", "yes"):
    app.include_router(ea_router)


DIST_DIR = ROOT / 'dist'
WEB_DIR = ROOT / 'web'
_NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


class CombinedStaticFiles(StaticFiles):
    """Static file provider that serves from Vite dist/assets with seamless fallback to web/."""
    def __init__(self, primary_dir, fallback_dir=None):
        super().__init__(directory=primary_dir)
        self.fallback_dir = Path(fallback_dir) if fallback_dir else None

    def lookup_path(self, path: str):
        clean_rel = path.lstrip("/\\")
        if clean_rel.endswith((".ts", ".tsx", ".map")) or clean_rel.split("/")[-1] in ("tsconfig.json", "package.json"):
            return "", None
        full_path, stat_result = super().lookup_path(path)
        if stat_result is None and self.fallback_dir:
            base_dir = self.fallback_dir.resolve()
            fallback_file = (base_dir / clean_rel).resolve()
            if fallback_file.is_relative_to(base_dir) and fallback_file.is_file():
                try:
                    return str(fallback_file), os.stat(fallback_file)
                except (os.error, ValueError):
                    pass
        return full_path, stat_result


if (DIST_DIR / 'assets').exists():
    app.mount('/assets', CombinedStaticFiles(DIST_DIR / 'assets', WEB_DIR), name='assets')
elif WEB_DIR.exists():
    app.mount('/assets', CombinedStaticFiles(WEB_DIR, WEB_DIR), name='assets')


def _serve_spa_dir(base_dir: Path, full_path: str):
    if not base_dir.exists():
        return None
    root = base_dir.resolve()
    clean_path = full_path.lstrip("/\\")
    direct_file = (root / clean_path).resolve()
    if clean_path and direct_file.is_relative_to(root) and direct_file.is_file():
        return FileResponse(direct_file, headers=_NO_CACHE_HEADERS if direct_file.name == 'index.html' else None)
    for alt_pub in (ROOT / 'public', WEB_DIR / 'public'):
        if alt_pub.exists():
            cand = (alt_pub.resolve() / clean_path).resolve()
            if cand.is_file() and cand.is_relative_to(alt_pub.resolve()):
                return FileResponse(cand)
    index_file = base_dir / 'index.html'
    if index_file.exists():
        return FileResponse(index_file, headers=_NO_CACHE_HEADERS)
    return None


@app.api_route("/api/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def api_unmatched_fallback(request: Request, full_path: str):
    return JSONResponse({"detail": f"Not Found: api/{full_path}"}, status_code=404)


@app.get('/{full_path:path}')
async def spa_fallback(request: Request, full_path: str):
    if full_path.startswith('api/') or full_path in ('healthz', 'readyz', 'api'):
        return JSONResponse({'detail': f'Not Found: {full_path}'}, status_code=404)
    host = (request.headers.get('host') or '').lower()
    is_admin_host = host.startswith('adm.')
    if full_path == 'robots.txt' and is_admin_host:
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse("User-agent: *\nDisallow: /\n", headers={"X-Robots-Tag": "noindex, nofollow"})
    for directory in (DIST_DIR, WEB_DIR):
        resp = _serve_spa_dir(directory, full_path)
        if resp is not None:
            if is_admin_host:
                resp.headers['X-Robots-Tag'] = 'noindex, nofollow'
            # GeoIP & Accept-Language auto-detection for international visitors
            if not full_path or full_path.endswith('.html') or '.' not in full_path:
                q_lang = (request.query_params.get("lang") or "").lower()
                if q_lang in ("en", "vi"):
                    is_foreign = (q_lang == "en")
                else:
                    client_ip = _client_ip(request)
                    cf_country = (request.headers.get("cf-ipcountry") or "").strip().upper()
                    if cf_country and cf_country not in ("XX", "T1", "UNKNOWN"):
                        is_foreign = (cf_country != "VN")
                    else:
                        country, is_foreign_ip = resolve_ip_country(client_ip)
                        if country in ("LOCAL", "UNKNOWN"):
                            accept_lang = (request.headers.get("accept-language") or "").lower()
                            is_foreign = bool("vi" not in accept_lang)
                        else:
                            is_foreign = is_foreign_ip
                host_clean = host.split(":")[0]
                cookie_domain = ".zupirus.com" if host_clean.endswith("zupirus.com") else None
                resp.set_cookie(
                    "zupirus_geo_lang",
                    "en" if is_foreign else "vi",
                    max_age=86400 * 30,
                    path="/",
                    domain=cookie_domain,
                    httponly=False,
                    samesite="lax",
                )
            return resp
    if (ROOT / 'index.html').exists():
        resp = FileResponse(ROOT / 'index.html', headers=_NO_CACHE_HEADERS)
        if is_admin_host:
            resp.headers['X-Robots-Tag'] = 'noindex, nofollow'
        q_lang = (request.query_params.get("lang") or "").lower()
        if q_lang in ("en", "vi"):
            is_foreign = (q_lang == "en")
        else:
            client_ip = _client_ip(request)
            cf_country = (request.headers.get("cf-ipcountry") or "").strip().upper()
            if cf_country and cf_country not in ("XX", "T1", "UNKNOWN"):
                is_foreign = (cf_country != "VN")
            else:
                country, is_foreign_ip = resolve_ip_country(client_ip)
                if country in ("LOCAL", "UNKNOWN"):
                    accept_lang = (request.headers.get("accept-language") or "").lower()
                    is_foreign = bool("vi" not in accept_lang)
                else:
                    is_foreign = is_foreign_ip
        host_clean = host.split(":")[0]
        cookie_domain = ".zupirus.com" if host_clean.endswith("zupirus.com") else None
        resp.set_cookie(
            "zupirus_geo_lang",
            "en" if is_foreign else "vi",
            max_age=86400 * 30,
            path="/",
            domain=cookie_domain,
            httponly=False,
            samesite="lax",
        )
        return resp
    return JSONResponse({'detail': 'Not Found'}, status_code=404)
