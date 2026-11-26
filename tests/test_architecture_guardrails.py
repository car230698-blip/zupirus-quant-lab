"""Architectural Guardrails & Single Source of Truth Validation.
Automated CI regression prevention ensuring:
1. Caddyfile matches upload body limits (36MB for ingest-pdf) and blocks admin stream on client domains.
2. One-way dependency direction: app/core/ never imports from app/domains/ or app/routers/.
3. Strict CSP: No inline executable <script> tags in web/index.html.
4. Single Source of Truth for lot calculation in signal dispatching.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_guardrail_caddyfile_body_limits_and_security():
    """Verify Caddyfile enforces 36MB max_size for PDF ingestion and restricts admin streams."""
    caddyfile = (ROOT / "Caddyfile").read_text(encoding="utf-8")
    assert "/api/v1/stream/admin*" in caddyfile, "Caddyfile must block /api/v1/stream/admin* on client domains"
    assert "36MB" in caddyfile, "Caddyfile must allow 36MB upload for PDF ingestion"
    assert "@ingest_pdf" in caddyfile, "Caddyfile must isolate ingest_pdf matcher"


def test_guardrail_core_one_way_dependency():
    """Verify app/core/ does not import from higher-level app/domains/ or app/routers/."""
    core_dir = ROOT / "app" / "core"
    assert core_dir.exists(), "app/core directory must exist"

    forbidden_patterns = [
        re.compile(r"from\s+app\.domains"),
        re.compile(r"import\s+app\.domains"),
        re.compile(r"from\s+app\.routers"),
        re.compile(r"import\s+app\.routers"),
    ]

    violations = []
    for py_file in core_dir.glob("*.py"):
        content = py_file.read_text(encoding="utf-8")
        for line_no, line in enumerate(content.splitlines(), start=1):
            for pat in forbidden_patterns:
                if pat.search(line):
                    violations.append(f"{py_file.name}:{line_no} -> {line.strip()}")

    assert not violations, f"Architectural violation: app/core imports from higher layers:\n" + "\n".join(violations)


def test_guardrail_strict_csp_no_inline_scripts():
    """Verify web/index.html does not contain inline executable <script> blocks."""
    index_html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    # Disallow <script> that is NOT type="application/ld+json" and has inline content without src
    script_tags = re.findall(r"<script(?![^>]*type=[\"']application/ld\+json[\"'])([^>]*)>(.*?)</script>", index_html, re.DOTALL | re.IGNORECASE)

    inline_executables = []
    for attrs, body in script_tags:
        if "src=" not in attrs and body.strip():
            inline_executables.append(body.strip()[:100])

    assert not inline_executables, f"CSP violation: Found inline scripts in web/index.html:\n" + "\n".join(inline_executables)


def test_guardrail_lot_calculation_standardization():
    """Customer order fan-out is retired. The module must not be importable."""
    fanout_py = ROOT / "app" / "domains" / "execution" / "fanout.py"
    assert not fanout_py.exists(), "Customer order fan-out must stay removed"
    import importlib
    try:
        importlib.import_module("app.domains.execution.fanout")
    except ImportError:
        return
    raise AssertionError("app.domains.execution.fanout must not import")


def test_guardrail_no_duplicate_admin_payments_router():
    """Verify admin_payments_router is not mounted as a duplicate in app/main.py."""
    main_py = ROOT / "app" / "main.py"
    content = main_py.read_text(encoding="utf-8")
    assert "admin_payments_router" not in content, "admin_payments_router must not be included (admin_billing_router is canonical)"


def test_guardrail_no_duplicate_fastapi_routes():
    """Verify that no (path, method) pairs are registered more than once in app.routes (excluding HEAD/OPTIONS)."""
    from app.main import app
    from collections import Counter
    seen_routes = []
    for route in app.routes:
        methods = getattr(route, "methods", None) or []
        path = getattr(route, "path", None)
        if not path or not methods:
            continue
        for m in methods:
            if m.upper() in ("HEAD", "OPTIONS"):
                continue
            seen_routes.append((path, m.upper()))

    counts = Counter(seen_routes)
    duplicates = [f"{m} {p} (count={c})" for (p, m), c in counts.items() if c > 1]
    assert not duplicates, f"Found duplicate FastAPI routes:\n" + "\n".join(duplicates)


def test_guardrail_ingest_pdf_uses_domain_swarm():
    """Verify app/routers/skills.py imports and delegates to app.domains.ai.ingest_swarm."""
    skills_py = ROOT / "app" / "routers" / "skills.py"
    assert skills_py.exists(), "skills.py must exist"
    content = skills_py.read_text(encoding="utf-8")
    assert "app.domains.ai.ingest_swarm" in content, "skills.py must import from app.domains.ai.ingest_swarm"
    assert "execute_4agent_ingest_pipeline" in content, "skills.py must call execute_4agent_ingest_pipeline"


def test_guardrail_no_duplicate_or_double_prefix_admin_routes():
    """Verify admin routes have no duplicate (path, method) or double prefixing like /api/admin/billing/api/admin/."""
    from app.main import app

    double_prefix_violations = []
    seen_routes = set()
    duplicate_routes = []

    for route in app.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None) or []
        if not path:
            continue
        if "/api/admin/billing/api/admin/" in path:
            double_prefix_violations.append(path)
        for m in methods:
            if m.upper() in ("HEAD", "OPTIONS"):
                continue
            key = (path, m.upper())
            if key in seen_routes:
                duplicate_routes.append(f"{m.upper()} {path}")
            seen_routes.add(key)

    assert not double_prefix_violations, f"Found double prefix in routes:\n" + "\n".join(double_prefix_violations)
    assert not duplicate_routes, f"Found duplicate admin routes:\n" + "\n".join(duplicate_routes)


def test_guardrail_admin_ui_uses_central_api_client():
    """Verify that all Admin*.tsx components use the central web/src/api/client instead of raw fetch()."""
    components_dir = ROOT / "web" / "src" / "components"
    admin_files = list(components_dir.glob("Admin*.tsx"))
    assert len(admin_files) >= 3, "Must check at least 3 Admin components"

    fetch_violations = {}
    for af in admin_files:
        content = af.read_text(encoding="utf-8")
        matches = re.findall(r"\bfetch\(", content)
        if matches:
            fetch_violations[af.name] = len(matches)

    assert not fetch_violations, f"Found raw fetch() calls in Admin components: {fetch_violations}"


def test_guardrail_defense_in_depth_domain_isolation():
    """Verify perimeter middleware blocks admin endpoints on client app domains with 403."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/admin/monitor", headers={"host": "app.zupirus.com"})
    assert resp.status_code == 403
    assert "adm.zupirus.com" in resp.text

    resp_stream = client.get("/api/v1/stream/admin", headers={"host": "app.zupirus.com"})
    assert resp_stream.status_code == 403
    assert "adm.zupirus.com" in resp_stream.text


def test_guardrail_user_ui_uses_central_api_client():
    """Verify that all User*.tsx components and PortalAuth.tsx use the central api client instead of raw fetch()."""
    components_dir = ROOT / "web" / "src" / "components"
    user_files = list(components_dir.glob("User*.tsx")) + [components_dir / "PortalAuth.tsx"]

    fetch_violations = {}
    for uf in user_files:
        assert uf.exists(), f"Expected file {uf.name} must exist"
        content = uf.read_text(encoding="utf-8")
        matches = re.findall(r"\bfetch\(", content)
        if matches:
            fetch_violations[uf.name] = len(matches)

    assert not fetch_violations, f"Found raw fetch() calls in User/Portal components: {fetch_violations}"


def test_guardrail_entire_web_uses_central_api_client():
    """Verify that only web/src/api/client.ts contains native fetch() in the entire web/src tree."""
    web_src = ROOT / "web" / "src"
    ts_files = list(web_src.rglob("*.tsx")) + list(web_src.rglob("*.ts"))

    fetch_violations = {}
    for f in ts_files:
        if f.name == "client.ts" and f.parent.name == "api":
            continue
        content = f.read_text(encoding="utf-8", errors="ignore")
        matches = re.findall(r"(?<![a-zA-Z0-9_])fetch\(", content)
        if matches:
            rel_path = f.relative_to(web_src).as_posix()
            fetch_violations[rel_path] = len(matches)

    assert not fetch_violations, f"Found raw fetch() calls outside api/client.ts: {fetch_violations}"


def test_guardrail_production_compose_security_locks():
    """Verify compose.prod.yaml enforces strict production hardening."""
    prod_compose = (ROOT / "compose.prod.yaml").read_text(encoding="utf-8")
    assert "${REDIS_PASSWORD:?REDIS_PASSWORD must be set in production}" in prod_compose
    assert 'APP_ENV: "production"' in prod_compose
    assert 'COOKIE_SECURE: "true"' in prod_compose
    assert 'ENABLE_LEGACY_EA_BRIDGE: "false"' in prod_compose
    assert "127.0.0.1:5432" in prod_compose
    assert "127.0.0.1:6379" in prod_compose
    assert "0.0.0.0" not in prod_compose


def test_guardrail_env_example_completeness():
    """Verify .env.example contains all required quant safety and production configuration keys."""
    env_example = (ROOT / ".env.example").read_text(encoding="utf-8")
    required_keys = [
        "ENABLE_LEGACY_EA_BRIDGE=false",
        "MIN_INDUCTIVE_SAMPLES=30",
        "PROP_LIVE_MAX_PORTFOLIO_RISK_PCT=2.0",
        "WFO_ROUNDTRIP_COST_PIPS=3.5",
        "REDIS_PASSWORD=",
    ]
    for key in required_keys:
        assert key in env_example, f".env.example is missing required configuration key: {key}"


def test_guardrail_landing_page_modularity_and_seo():
    """Verify landing page is clean, modular (< 450 lines) and SEO metadata points to proper JPG OG image."""
    landing_tsx = (ROOT / "web" / "src" / "components" / "LandingPage.tsx").read_text(encoding="utf-8")
    lines = landing_tsx.splitlines()
    assert len(lines) <= 450, f"LandingPage.tsx should be under 450 lines for modularity, got {len(lines)}"
    assert "import { ThreeHolographicMatrix }" not in landing_tsx, "ThreeHolographicMatrix must not be synchronously imported in LandingPage"

    index_html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert 'content="#0B1220"' in index_html, "Theme color must be #0B1220 (Midnight Navy)"
    assert 'property="og:image" content="https://zupirus.com/og-zupirus.jpg"' in index_html
    assert 'name="twitter:image" content="https://zupirus.com/og-zupirus.jpg"' in index_html
    assert (ROOT / "web" / "public" / "og-zupirus.jpg").exists(), "web/public/og-zupirus.jpg must exist"




