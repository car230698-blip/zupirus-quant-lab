"""Understand-Anything Codebase Knowledge Graph (Scan -> Map -> Teach) for ZUPIRUS Quant Lab.

Deterministically parses Python (via ast) and TypeScript/React (via import/export regex)
to produce an interactive architectural graph (`data/understand-anything/knowledge-graph.json`)
with architectural layers, dependency edges, hotspots, and business-flow guided tours.
"""
from __future__ import annotations

import ast
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
GRAPH_ARTIFACT_PATH = REPO_ROOT / "data" / "understand-anything" / "knowledge-graph.json"

LAYERS: List[Dict[str, Any]] = [
    {"id": "frontend", "label": "Frontend UI (React/TS)", "color": "#38bdf8", "order": 0},
    {"id": "api", "label": "API & Routers (FastAPI)", "color": "#f59e0b", "order": 1},
    {"id": "execution", "label": "Quant Engine & Cloud MT5", "color": "#10b981", "order": 2},
    {"id": "ai", "label": "AI Swarm, Research & Skills", "color": "#a855f7", "order": 3},
    {"id": "data", "label": "Data, Security & Billing", "color": "#f43f5e", "order": 4},
    {"id": "ops", "label": "CLI, Scripts & Ops", "color": "#94a3b8", "order": 5},
]

GUIDED_TOURS: List[Dict[str, Any]] = [
    {
        "id": "trading-pipeline",
        "title": "Luồng Khớp Lệnh & 4 Lớp Giáp (Trading Pipeline)",
        "description": "Từ nguồn tín hiệu TradingView/AI -> kiểm tra 4 lớp giáp (Idempotency, SL/Spread, News Shield, Slippage) -> tính Lot chuẩn Cent/Prop -> Fan-out đa tài khoản Cloud MT5 & PositionWatcher.",
        "nodes": [
            "app/routers/webhooks.py",
            "app/routers/signals.py",
            "app/engine.py",
            "app/services/account_classifier.py",
            "app/services/execution/fanout.py",
            "app/metaapi.py",
            "app/services/execution/watcher.py",
        ],
    },
    {
        "id": "auth-billing",
        "title": "Xác Thực, OTP & Thanh Toán SePay VietQR",
        "description": "Đăng ký/đăng nhập OTP bảo mật -> mã hóa khóa v2 enc: -> tạo đơn SePay VietQR với tỷ giá USD/VND -> Webhook tự động kích hoạt gói & cấp slot MT5.",
        "nodes": [
            "web/src/components/PortalAuth.tsx",
            "app/routers/auth.py",
            "app/security.py",
            "web/src/components/UserAccountsTab.tsx",
            "app/services/fx_rate.py",
            "app/services/billing_service.py",
            "app/routers/webhooks.py",
            "app/routers/admin_billing.py",
        ],
    },
    {
        "id": "ai-evolution",
        "title": "AI Tự Tiến Hóa, Chấm Điểm Nguồn & Hindsight",
        "description": "Khám phá nguồn tín hiệu -> chấm điểm lệnh ẩn M1 (shadow_signals) -> đúc kết bài học Hindsight -> kiểm định Walk-Forward OOS & tự sinh kỹ năng.",
        "nodes": [
            "app/services/sources/discovery.py",
            "app/services/sources/curator.py",
            "app/research.py",
            "app/gemini_client.py",
            "app/skills/registry.py",
            "app/routers/telemetry_admin.py",
            "web/src/components/AdminAIEvolutionTab.tsx",
        ],
    },
    {
        "id": "realtime-ui",
        "title": "Luồng Real-Time SSE & Giao Diện Portal",
        "description": "Redis Streams đẩy sự kiện tức thì -> SSE /api/v1/stream/* -> React Query & PortalChrome đồng bộ Topbar, Admin Command Radar và Sổ Cái Lệnh.",
        "nodes": [
            "app/redis_client.py",
            "app/routers/realtime.py",
            "app/routers/telemetry.py",
            "web/src/hooks/useQuantData.ts",
            "web/src/components/PortalChrome.tsx",
            "web/src/components/AdminCommandRadarTab.tsx",
            "web/src/components/UserOverviewTab.tsx",
            "web/src/components/UserOrdersTab.tsx",
        ],
    },
]

_TS_IMPORT_RE = re.compile(r"""(?:import|export)\s+[^'"]*?from\s+['"]([^'"]+)['"]""")
_TS_SYMBOL_RE = re.compile(r"""export\s+(?:default\s+)?(?:const|function|class|interface|type)\s+([A-Za-z0-9_]+)""")

_CACHED_GRAPH: Optional[Dict[str, Any]] = None


def _classify_layer(rel_path: str) -> str:
    p = rel_path.replace("\\", "/")
    if p.startswith(("web/src/", "src/")):
        return "frontend"
    if p.startswith(("cli/", "scripts/")):
        return "ops"
    if p.startswith("app/routers/") or p == "app/main.py":
        return "api"
    if (
        p.startswith("app/services/execution/")
        or p in ("app/engine.py", "app/metaapi.py", "app/services/account_classifier.py", "app/services/symbol_precision.py", "app/services/symbol_mapper.py")
    ):
        return "execution"
    if (
        p.startswith(("app/skills/", "app/services/sources/", "app/services/signal_ingestion/"))
        or p in ("app/research.py", "app/gemini_client.py", "app/hindsight.py", "app/swarm.py")
        or "ai" in Path(p).stem.lower()
    ):
        return "ai"
    return "data"


def _summarize_module(rel_path: str, docstring: str, symbols: List[str], layer: str) -> str:
    if docstring:
        first_line = docstring.strip().splitlines()[0].strip()
        if len(first_line) > 12:
            return first_line[:180]
    layer_labels = {
        "frontend": "Component / module giao diện React TypeScript",
        "api": "Router FastAPI xử lý REST/SSE endpoint",
        "execution": "Module lõi thực thi lệnh, tính Lot và bảo vệ tài khoản MT5",
        "ai": "Module AI Swarm, nghiên cứu chiến lược và kỹ năng tự tiến hóa",
        "data": "Module dữ liệu, bảo mật, thanh toán hoặc cấu hình lõi",
        "ops": "Script vận hành, sao lưu dữ liệu hoặc kiểm thử E2E/CLI",
    }
    sym_preview = f" ({', '.join(symbols[:4])})" if symbols else ""
    return f"{layer_labels.get(layer, 'Module hệ thống')}{sym_preview}."


def _collect_source_files(root: Path) -> List[Path]:
    targets: List[Path] = []
    scan_dirs = [root / "app", root / "cli", root / "scripts", root / "web" / "src", root / "src"]
    skip_parts = {"__pycache__", "node_modules", "dist", ".git", "tests"}
    for base in scan_dirs:
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file():
                continue
            if any(part in skip_parts for part in p.parts):
                continue
            if p.name.endswith((".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".d.ts")):
                continue
            if p.suffix in (".py", ".ts", ".tsx"):
                targets.append(p)
    return targets


def _parse_python_file(path: Path, rel_path: str) -> Tuple[str, List[str], List[str], int]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    loc = len(text.splitlines())
    docstring = ""
    symbols: List[str] = []
    imports: List[str] = []
    try:
        tree = ast.parse(text)
        docstring = ast.get_docstring(tree) or ""
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                if not node.name.startswith("_"):
                    symbols.append(node.name)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.append(alias.name)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.append(node.module)
    except SyntaxError:
        pass
    return docstring, symbols[:14], imports, loc


def _parse_ts_file(path: Path) -> Tuple[str, List[str], List[str], int]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    loc = len(text.splitlines())
    symbols = _TS_SYMBOL_RE.findall(text)[:14]
    imports = _TS_IMPORT_RE.findall(text)
    docstring = ""
    for line in text.splitlines()[:6]:
        s = line.strip()
        if s.startswith(("//", "/*", "*")):
            cleaned = s.lstrip("/* ").rstrip("*/ ").strip()
            if len(cleaned) > 15:
                docstring = cleaned
                break
    return docstring, symbols, imports, loc


def build_code_knowledge_graph(root: Path = REPO_ROOT, persist: bool = True) -> Dict[str, Any]:
    """Scan the repository and build the Understand-Anything knowledge graph."""
    global _CACHED_GRAPH
    files = _collect_source_files(root)

    # Map module names / relative paths -> canonical node id (POSIX relative path)
    node_ids: Set[str] = set()
    py_module_map: Dict[str, str] = {}
    for f in files:
        rel = f.relative_to(root).as_posix()
        node_ids.add(rel)
        if f.suffix == ".py":
            mod = rel[:-3].replace("/", ".")
            if mod.endswith(".__init__"):
                py_module_map[mod[:-9]] = rel
            py_module_map[mod] = rel

    nodes_raw: Dict[str, Dict[str, Any]] = {}
    edges_set: Set[Tuple[str, str, str]] = set()

    for f in files:
        rel = f.relative_to(root).as_posix()
        layer = _classify_layer(rel)
        if f.suffix == ".py":
            doc, syms, imps, loc = _parse_python_file(f, rel)
            lang = "python"
            for imp in imps:
                target = py_module_map.get(imp)
                if not target and "." in imp:
                    parent = imp.rsplit(".", 1)[0]
                    target = py_module_map.get(parent)
                if target and target != rel:
                    edges_set.add((rel, target, "imports"))
        else:
            doc, syms, imps, loc = _parse_ts_file(f)
            lang = "typescript"
            for imp in imps:
                if not imp.startswith("."):
                    continue
                resolved_base = (f.parent / imp).resolve()
                candidates = [
                    resolved_base,
                    resolved_base.with_suffix(".ts"),
                    resolved_base.with_suffix(".tsx"),
                    resolved_base / "index.ts",
                    resolved_base / "index.tsx",
                ]
                for cand in candidates:
                    try:
                        cand_rel = cand.relative_to(root).as_posix()
                    except ValueError:
                        continue
                    if cand_rel in node_ids and cand_rel != rel:
                        edges_set.add((rel, cand_rel, "imports"))
                        break

        nodes_raw[rel] = {
            "id": rel,
            "name": f.name,
            "path": rel,
            "layer": layer,
            "language": lang,
            "loc": loc,
            "symbols": syms,
            "summary": _summarize_module(rel, doc, syms, layer),
            "in_degree": 0,
            "out_degree": 0,
        }

    edges: List[Dict[str, str]] = []
    for src, dst, kind in sorted(edges_set):
        if src in nodes_raw and dst in nodes_raw:
            nodes_raw[src]["out_degree"] += 1
            nodes_raw[dst]["in_degree"] += 1
            edges.append({"source": src, "target": dst, "type": kind})

    # Assign deterministic layered (x, y) coordinates so the SVG canvas is clean & readable
    layer_order = {l["id"]: l["order"] for l in LAYERS}
    by_layer: Dict[str, List[Dict[str, Any]]] = {l["id"]: [] for l in LAYERS}
    for nd in nodes_raw.values():
        by_layer[nd["layer"]].append(nd)

    nodes: List[Dict[str, Any]] = []
    col_spacing = 280
    row_spacing = 68
    for layer_meta in LAYERS:
        lid = layer_meta["id"]
        group = sorted(
            by_layer[lid],
            key=lambda n: (-(n["in_degree"] + n["out_degree"]), -n["loc"], n["name"]),
        )
        x = 90 + layer_order[lid] * col_spacing
        for idx, nd in enumerate(group):
            nd["x"] = x
            nd["y"] = 78 + idx * row_spacing
            nodes.append(nd)

    hotspots = sorted(
        nodes,
        key=lambda n: (-(n["in_degree"] + n["out_degree"]), -n["loc"]),
    )[:8]

    # Filter tour nodes to existing files
    tours = []
    for t in GUIDED_TOURS:
        valid_nodes = [nid for nid in t["nodes"] if nid in nodes_raw]
        tours.append({**t, "nodes": valid_nodes})

    graph: Dict[str, Any] = {
        "schema": "understand-anything/v1",
        "project": "zupirus-quant-lab",
        "generated_at": time.time(),
        "stats": {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "total_loc": sum(n["loc"] for n in nodes),
            "layers_count": len(LAYERS),
            "python_files": sum(1 for n in nodes if n["language"] == "python"),
            "ts_files": sum(1 for n in nodes if n["language"] == "typescript"),
        },
        "layers": LAYERS,
        "tours": tours,
        "hotspots": [
            {
                "id": h["id"],
                "name": h["name"],
                "layer": h["layer"],
                "in_degree": h["in_degree"],
                "out_degree": h["out_degree"],
                "loc": h["loc"],
            }
            for h in hotspots
        ],
        "nodes": nodes,
        "edges": edges,
    }

    if persist:
        for target_path in (
            GRAPH_ARTIFACT_PATH,
            Path(os.getenv("DATA_DIR", "/data")) / "understand-anything" / "knowledge-graph.json",
        ):
            try:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
                break
            except OSError:
                continue

    _CACHED_GRAPH = graph
    return graph


def get_code_knowledge_graph(force_rescan: bool = False) -> Dict[str, Any]:
    """Return cached or freshly scanned Understand-Anything knowledge graph."""
    global _CACHED_GRAPH
    if not force_rescan and _CACHED_GRAPH is not None:
        return _CACHED_GRAPH

    if not force_rescan:
        for p in (
            Path(os.getenv("DATA_DIR", "/data")) / "understand-anything" / "knowledge-graph.json",
            GRAPH_ARTIFACT_PATH,
        ):
            try:
                if p.is_file():
                    _CACHED_GRAPH = json.loads(p.read_text(encoding="utf-8"))
                    return _CACHED_GRAPH
            except Exception:
                continue

    return build_code_knowledge_graph(persist=True)
