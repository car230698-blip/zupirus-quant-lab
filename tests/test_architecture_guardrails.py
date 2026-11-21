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
    """Verify direct signal execution calls normalized lot size in domain."""
    fanout_py = ROOT / "app" / "domains" / "execution" / "fanout.py"
    assert fanout_py.exists(), "Domain fanout.py must exist"
    content = fanout_py.read_text(encoding="utf-8")
    assert "calculate_normalized_lot_size" in content, "Fanout must use calculate_normalized_lot_size"


def test_guardrail_no_duplicate_admin_payments_router():
    """Verify admin_payments_router is not mounted as a duplicate in app/main.py."""
    main_py = ROOT / "app" / "main.py"
    content = main_py.read_text(encoding="utf-8")
    assert "admin_payments_router" not in content, "admin_payments_router must not be included (admin_billing_router is canonical)"
