"""colbymchenry/codegraph integration service for ZUPIRUS Admin Portal.

Reads the real SQLite index produced by `@colbymchenry/codegraph` (`.codegraph/codegraph.db`)
or its committed portable snapshot (`data/codegraph/snapshot.json` for Docker/VPS), providing:
- 6-layer Architecture Overview & inter-layer call/import flow counts
- Symbol Search (functions, FastAPI routes, classes, methods, interfaces)
- Live Call Graph (Callers -> Symbol -> Callees) & 2-hop Impact/Blast Radius
- Architectural Hotspots & Dead Code candidates
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

REPO_ROOT = Path(__file__).resolve().parents[2]
CODEGRAPH_DB_PATH = REPO_ROOT / ".codegraph" / "codegraph.db"
SNAPSHOT_PATH = REPO_ROOT / "data" / "codegraph" / "snapshot.json"

SYMBOL_KINDS = ("function", "method", "class", "route", "interface", "type_alias")
SEMANTIC_EDGE_KINDS = ("calls", "imports", "references", "instantiates", "extends")

LAYERS: List[Dict[str, Any]] = [
    {"id": "frontend", "label": "Frontend UI (React/TS)", "color": "#38bdf8", "order": 0},
    {"id": "api", "label": "API & Routers (FastAPI)", "color": "#f59e0b", "order": 1},
    {"id": "execution", "label": "Quant Engine & Cloud MT5", "color": "#10b981", "order": 2},
    {"id": "ai", "label": "AI Swarm, Research & Skills", "color": "#a855f7", "order": 3},
    {"id": "data", "label": "Data, Security & Billing", "color": "#f43f5e", "order": 4},
    {"id": "ops", "label": "CLI, Scripts & Ops", "color": "#94a3b8", "order": 5},
]

_CACHE: Optional[Dict[str, Any]] = None


def _norm_path(p: str) -> str:
    s = str(p or "").replace("\\", "/")
    root_str = str(REPO_ROOT).replace("\\", "/").rstrip("/") + "/"
    if s.lower().startswith(root_str.lower()):
        s = s[len(root_str):]
    return s.lstrip("./")


def _classify_layer(rel_path: str) -> str:
    p = rel_path.replace("\\", "/")
    if p.startswith(("web/src/", "src/")):
        return "frontend"
    if p.startswith(("cli/", "scripts/", ".github/")):
        return "ops"
    if p.startswith("app/routers/") or p == "app/main.py":
        return "api"
    if (
        p.startswith("app/services/execution/")
        or p in (
            "app/engine.py",
            "app/metaapi.py",
            "app/services/account_classifier.py",
            "app/services/symbol_precision.py",
            "app/services/symbol_mapper.py",
        )
    ):
        return "execution"
    if (
        p.startswith(("app/skills/", "app/services/sources/", "app/services/signal_ingestion/"))
        or p in ("app/research.py", "app/gemini_client.py", "app/hindsight.py", "app/swarm.py")
        or "ai" in Path(p).stem.lower()
    ):
        return "ai"
    return "data"


def export_snapshot_from_db(db_path: Path = CODEGRAPH_DB_PATH, out_path: Path = SNAPSHOT_PATH) -> Dict[str, Any]:
    """Read `.codegraph/codegraph.db` and export a compact portable snapshot for Docker/VPS."""
    if not db_path.is_file():
        raise FileNotFoundError(f"CodeGraph DB not found at {db_path}")

    con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        files_rows = con.execute(
            "SELECT path, language, size, node_count FROM files ORDER BY path"
        ).fetchall()
        files = [
            {
                "path": _norm_path(r["path"]),
                "language": r["language"],
                "size": int(r["size"] or 0),
                "node_count": int(r["node_count"] or 0),
                "layer": _classify_layer(_norm_path(r["path"])),
            }
            for r in files_rows
        ]

        kind_placeholders = ",".join("?" for _ in SYMBOL_KINDS)
        node_rows = con.execute(
            f"""
            SELECT id, kind, name, qualified_name, file_path, language,
                   start_line, end_line, docstring, signature, is_exported, is_async
            FROM nodes
            WHERE kind IN ({kind_placeholders})
            ORDER BY file_path, start_line
            """,
            SYMBOL_KINDS,
        ).fetchall()

        symbols: List[Dict[str, Any]] = []
        symbol_ids: Set[str] = set()
        for r in node_rows:
            fp = _norm_path(r["file_path"])
            nid = r["id"]
            symbol_ids.add(nid)
            doc = str(r["docstring"] or "").strip()
            symbols.append(
                {
                    "id": nid,
                    "kind": r["kind"],
                    "name": r["name"],
                    "qualified_name": r["qualified_name"] or r["name"],
                    "file_path": fp,
                    "layer": _classify_layer(fp),
                    "language": r["language"],
                    "start_line": int(r["start_line"] or 0),
                    "end_line": int(r["end_line"] or 0),
                    "signature": str(r["signature"] or "")[:160],
                    "docstring": doc.splitlines()[0][:180] if doc else "",
                    "is_exported": bool(r["is_exported"]),
                    "is_async": bool(r["is_async"]),
                }
            )

        # Map file-level node ids to file paths for import edges
        file_node_rows = con.execute("SELECT id, file_path FROM nodes WHERE kind = 'file'").fetchall()
        file_node_map = {r["id"]: _norm_path(r["file_path"]) for r in file_node_rows}

        edge_placeholders = ",".join("?" for _ in SEMANTIC_EDGE_KINDS)
        edge_rows = con.execute(
            f"SELECT source, target, kind, line FROM edges WHERE kind IN ({edge_placeholders})",
            SEMANTIC_EDGE_KINDS,
        ).fetchall()

        symbol_edges: List[Dict[str, Any]] = []
        file_edges_count: Dict[tuple, int] = defaultdict(int)
        symbol_file_map = {s["id"]: s["file_path"] for s in symbols}

        for r in edge_rows:
            src, dst, kind = r["source"], r["target"], r["kind"]
            if src in symbol_ids and dst in symbol_ids and src != dst:
                symbol_edges.append({"source": src, "target": dst, "kind": kind, "line": int(r["line"] or 0)})
            sf = symbol_file_map.get(src) or file_node_map.get(src)
            tf = symbol_file_map.get(dst) or file_node_map.get(dst)
            if sf and tf and sf != tf:
                file_edges_count[(sf, tf)] += 1

        total_nodes_raw = con.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
        total_edges_raw = con.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
        edge_breakdown = dict(con.execute("SELECT kind, COUNT(*) FROM edges GROUP BY kind").fetchall())
        node_breakdown = dict(con.execute("SELECT kind, COUNT(*) FROM nodes GROUP BY kind").fetchall())
    finally:
        con.close()

    snapshot: Dict[str, Any] = {
        "engine": "@colbymchenry/codegraph",
        "project": "zupirus-quant-lab",
        "generated_at": time.time(),
        "raw_stats": {
            "files": len(files),
            "total_nodes": int(total_nodes_raw),
            "total_edges": int(total_edges_raw),
            "symbols_indexed": len(symbols),
            "symbol_edges": len(symbol_edges),
            "node_breakdown": node_breakdown,
            "edge_breakdown": edge_breakdown,
        },
        "files": files,
        "symbols": symbols,
        "edges": symbol_edges,
        "file_edges": [
            {"source": sf, "target": tf, "count": cnt}
            for (sf, tf), cnt in sorted(file_edges_count.items())
        ],
    }

    for target in (out_path, Path(os.getenv("DATA_DIR", "/data")) / "codegraph" / "snapshot.json"):
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
            break
        except OSError:
            continue

    return snapshot


def _load_snapshot(force: bool = False) -> Dict[str, Any]:
    global _CACHE
    if not force and _CACHE is not None:
        return _CACHE

    if CODEGRAPH_DB_PATH.is_file():
        _CACHE = export_snapshot_from_db(CODEGRAPH_DB_PATH, SNAPSHOT_PATH)
        return _CACHE

    for p in (Path(os.getenv("DATA_DIR", "/data")) / "codegraph" / "snapshot.json", SNAPSHOT_PATH):
        if p.is_file():
            _CACHE = json.loads(p.read_text(encoding="utf-8"))
            return _CACHE

    return {
        "engine": "@colbymchenry/codegraph",
        "project": "zupirus-quant-lab",
        "generated_at": time.time(),
        "raw_stats": {"files": 0, "total_nodes": 0, "total_edges": 0, "symbols_indexed": 0, "symbol_edges": 0, "node_breakdown": {}, "edge_breakdown": {}},
        "files": [],
        "symbols": [],
        "edges": [],
        "file_edges": [],
    }


def get_codegraph_overview(force_reload: bool = False) -> Dict[str, Any]:
    """Return high-level CodeGraph metrics, 6-layer map, hotspots, routes, and dead code."""
    snap = _load_snapshot(force=force_reload)
    files = snap.get("files", [])
    symbols = snap.get("symbols", [])
    edges = snap.get("edges", [])
    file_edges = snap.get("file_edges", [])

    in_deg: Dict[str, int] = defaultdict(int)
    out_deg: Dict[str, int] = defaultdict(int)
    for e in edges:
        out_deg[e["source"]] += 1
        in_deg[e["target"]] += 1

    # Layer aggregation
    file_layer = {f["path"]: f["layer"] for f in files}
    layer_stats: Dict[str, Dict[str, Any]] = {
        l["id"]: {"id": l["id"], "label": l["label"], "color": l["color"], "order": l["order"], "files": 0, "symbols": 0, "routes": 0, "top_files": []}
        for l in LAYERS
    }
    file_in: Dict[str, int] = defaultdict(int)
    file_out: Dict[str, int] = defaultdict(int)
    inter_layer: Dict[tuple, int] = defaultdict(int)

    for fe in file_edges:
        sf, tf, cnt = fe["source"], fe["target"], int(fe["count"])
        file_out[sf] += cnt
        file_in[tf] += cnt
        sl, tl = file_layer.get(sf), file_layer.get(tf)
        if sl and tl and sl != tl:
            inter_layer[(sl, tl)] += cnt

    files_by_layer: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for f in files:
        lid = f["layer"]
        if lid in layer_stats:
            layer_stats[lid]["files"] += 1
            files_by_layer[lid].append(
                {
                    "path": f["path"],
                    "name": Path(f["path"]).name,
                    "language": f["language"],
                    "node_count": f["node_count"],
                    "in_edges": file_in[f["path"]],
                    "out_edges": file_out[f["path"]],
                }
            )

    for lid, flist in files_by_layer.items():
        flist.sort(key=lambda x: (-(x["in_edges"] + x["out_edges"]), -x["node_count"]))
        layer_stats[lid]["top_files"] = flist[:5]

    routes_count = 0
    for s in symbols:
        lid = s["layer"]
        if lid in layer_stats:
            layer_stats[lid]["symbols"] += 1
            if s["kind"] == "route":
                layer_stats[lid]["routes"] += 1
                routes_count += 1

    # Hotspots: top called symbols
    enriched_symbols = [
        {**s, "callers_count": in_deg[s["id"]], "callees_count": out_deg[s["id"]]}
        for s in symbols
    ]
    hotspots = sorted(
        [s for s in enriched_symbols if s["kind"] in ("function", "method", "class")],
        key=lambda x: (-x["callers_count"], -x["callees_count"]),
    )[:15]

    # Dead code candidates: non-exported/internal functions or classes with 0 callers (excluding routes, tests, dunders, React main)
    dead_code = [
        s
        for s in enriched_symbols
        if s["kind"] in ("function", "class")
        and s["callers_count"] == 0
        and not s["name"].startswith(("__", "test_"))
        and not s["file_path"].startswith(("tests/", "scripts/"))
        and s["name"] not in ("main", "App", "app")
    ][:40]

    languages: Dict[str, int] = defaultdict(int)
    for f in files:
        languages[f["language"]] += 1

    return {
        "engine": snap.get("engine", "@colbymchenry/codegraph"),
        "project": snap.get("project", "zupirus-quant-lab"),
        "generated_at": snap.get("generated_at", time.time()),
        "stats": {
            **snap.get("raw_stats", {}),
            "routes_count": routes_count,
            "dead_code_count": len(dead_code),
            "languages": dict(languages),
        },
        "layers": sorted(layer_stats.values(), key=lambda x: x["order"]),
        "inter_layer_edges": [
            {"from": a, "to": b, "count": cnt}
            for (a, b), cnt in sorted(inter_layer.items(), key=lambda kv: -kv[1])
        ],
        "hotspots": hotspots,
        "dead_code": dead_code,
        "files_by_layer": {lid: flist[:30] for lid, flist in files_by_layer.items()},
    }


def query_codegraph_symbol(q: str = "", symbol_id: str = "", limit: int = 30) -> Dict[str, Any]:
    """Search symbols & compute live Call Graph (Callers, Callees) + 2-hop Impact Radius."""
    snap = _load_snapshot(force=False)
    symbols = snap.get("symbols", [])
    edges = snap.get("edges", [])

    sym_map = {s["id"]: s for s in symbols}
    callers_map: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    callees_map: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for e in edges:
        src, dst = e["source"], e["target"]
        if src in sym_map and dst in sym_map:
            callers_map[dst].append({"symbol": sym_map[src], "kind": e["kind"], "line": e.get("line", 0)})
            callees_map[src].append({"symbol": sym_map[dst], "kind": e["kind"], "line": e.get("line", 0)})

    matches: List[Dict[str, Any]] = []
    ql = q.strip().lower()
    for s in symbols:
        if ql:
            if (
                ql in s["name"].lower()
                or ql in s["qualified_name"].lower()
                or ql in s["file_path"].lower()
            ):
                matches.append(
                    {
                        **s,
                        "callers_count": len(callers_map[s["id"]]),
                        "callees_count": len(callees_map[s["id"]]),
                    }
                )
        else:
            matches.append(
                {
                    **s,
                    "callers_count": len(callers_map[s["id"]]),
                    "callees_count": len(callees_map[s["id"]]),
                }
            )

    matches.sort(key=lambda x: (-x["callers_count"], -x["callees_count"], x["name"]))
    matches = matches[:limit]

    selected_id = symbol_id if symbol_id in sym_map else (matches[0]["id"] if matches else "")
    selected = None
    callers: List[Dict[str, Any]] = []
    callees: List[Dict[str, Any]] = []
    impact = {"affected_symbols": 0, "affected_files": 0, "files": []}

    if selected_id and selected_id in sym_map:
        selected = {
            **sym_map[selected_id],
            "callers_count": len(callers_map[selected_id]),
            "callees_count": len(callees_map[selected_id]),
        }
        # Deduplicate callers/callees by id
        seen_c: Set[str] = set()
        for item in callers_map[selected_id]:
            sid = item["symbol"]["id"]
            if sid not in seen_c:
                seen_c.add(sid)
                callers.append({**item["symbol"], "edge_kind": item["kind"], "call_line": item["line"]})
        seen_o: Set[str] = set()
        for item in callees_map[selected_id]:
            sid = item["symbol"]["id"]
            if sid not in seen_o:
                seen_o.add(sid)
                callees.append({**item["symbol"], "edge_kind": item["kind"], "call_line": item["line"]})

        # 2-hop upstream Impact/Blast Radius via BFS over callers
        visited: Set[str] = {selected_id}
        queue = deque([(selected_id, 0)])
        affected_files: Set[str] = set()
        while queue:
            cur, depth = queue.popleft()
            if depth >= 2:
                continue
            for item in callers_map[cur]:
                cid = item["symbol"]["id"]
                if cid not in visited:
                    visited.add(cid)
                    affected_files.add(item["symbol"]["file_path"])
                    queue.append((cid, depth + 1))

        visited.discard(selected_id)
        impact = {
            "affected_symbols": len(visited),
            "affected_files": len(affected_files),
            "files": sorted(affected_files)[:20],
        }

    return {
        "query": q,
        "matches": matches,
        "selected": selected,
        "callers": callers[:30],
        "callees": callees[:30],
        "impact": impact,
    }


def trigger_codegraph_reindex() -> Dict[str, Any]:
    """Re-index via `@colbymchenry/codegraph` CLI if available, then reload snapshot."""
    cli_ran = False
    try:
        res = subprocess.run(
            ["codegraph", "index"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=30,
        )
        cli_ran = res.returncode == 0
    except Exception:
        cli_ran = False

    overview = get_codegraph_overview(force_reload=True)
    overview["cli_reindexed"] = cli_ran
    return overview
