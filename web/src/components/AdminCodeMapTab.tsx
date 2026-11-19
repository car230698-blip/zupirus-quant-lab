import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MetricCard, Panel, StatusBadge } from './ui/Primitives';
import { IconActivity, IconServer, IconSearch, IconShield, IconTrendingUp } from './Icons';

interface GraphLayer {
  id: string;
  label: string;
  color: string;
  order: number;
}

interface GraphNode {
  id: string;
  name: string;
  path: string;
  layer: string;
  language: 'python' | 'typescript';
  loc: number;
  symbols: string[];
  summary: string;
  in_degree: number;
  out_degree: number;
  x: number;
  y: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

interface GuidedTour {
  id: string;
  title: string;
  description: string;
  nodes: string[];
}

interface CodeGraphPayload {
  schema: string;
  project: string;
  generated_at: number;
  stats: {
    total_nodes: number;
    total_edges: number;
    total_loc: number;
    layers_count: number;
    python_files: number;
    ts_files: number;
  };
  layers: GraphLayer[];
  tours: GuidedTour[];
  hotspots: Array<{
    id: string;
    name: string;
    layer: string;
    in_degree: number;
    out_degree: number;
    loc: number;
  }>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const OVERVIEW_POS: Record<string, { x: number; y: number }> = {
  frontend: { x: 40, y: 40 },
  api: { x: 350, y: 40 },
  execution: { x: 660, y: 40 },
  ai: { x: 660, y: 270 },
  data: { x: 350, y: 270 },
  ops: { x: 40, y: 270 },
};

export const AdminCodeMapTab: React.FC = () => {
  const [graph, setGraph] = useState<CodeGraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'overview' | 'detail'>('overview');
  const [search, setSearch] = useState('');
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>({});
  const [activeTourId, setActiveTourId] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // 1:1 CSS-pixel Pan & Zoom state (no shrinking viewBox!)
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 24, y: 16 });
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; origX: number; origY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const loadGraph = useCallback(async (forceRescan = false) => {
    try {
      if (forceRescan) setRescanning(true);
      else setLoading(true);
      setError(null);
      const res = await fetch(
        forceRescan ? '/api/v1/telemetry/code-map/rescan' : '/api/v1/telemetry/code-map',
        {
          method: forceRescan ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
          credentials: 'include',
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `HTTP ${res.status}`);
      }
      const data: CodeGraphPayload = await res.json();
      setGraph(data);
      setEnabledLayers((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const init: Record<string, boolean> = {};
        data.layers.forEach((l) => {
          init[l.id] = true;
        });
        return init;
      });
      if (!selectedNodeId && data.hotspots?.length) {
        setSelectedNodeId(data.hotspots[0].id);
      }
    } catch (e: any) {
      setError(e?.message || 'Không thể tải bản đồ mã nguồn');
    } finally {
      setLoading(false);
      setRescanning(false);
    }
  }, [selectedNodeId]);

  useEffect(() => {
    void loadGraph(false);
  }, []);

  const layerColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    (graph?.layers || []).forEach((l) => {
      m[l.id] = l.color;
    });
    return m;
  }, [graph]);

  const activeTour = useMemo(
    () => (graph?.tours || []).find((t) => t.id === activeTourId) || null,
    [graph, activeTourId],
  );
  const tourNodeSet = useMemo(() => new Set(activeTour?.nodes || []), [activeTour]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, GraphNode>();
    (graph?.nodes || []).forEach((n) => m.set(n.id, n));
    return m;
  }, [graph]);

  // Aggregate layer stats & inter-layer edges for the crisp Architecture Overview mode
  const layerOverview = useMemo(() => {
    if (!graph) return { statsByLayer: {}, interEdges: [] as Array<{ from: string; to: string; count: number }> };
    const statsByLayer: Record<string, { count: number; loc: number; topNodes: GraphNode[] }> = {};
    graph.layers.forEach((l) => {
      statsByLayer[l.id] = { count: 0, loc: 0, topNodes: [] };
    });
    graph.nodes.forEach((n) => {
      const st = statsByLayer[n.layer];
      if (st) {
        st.count += 1;
        st.loc += n.loc;
        st.topNodes.push(n);
      }
    });
    Object.values(statsByLayer).forEach((st) => {
      st.topNodes.sort((a, b) => b.in_degree + b.out_degree - (a.in_degree + a.out_degree));
      st.topNodes = st.topNodes.slice(0, 4);
    });

    const edgeCounts = new Map<string, number>();
    graph.edges.forEach((e) => {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      if (!s || !t || s.layer === t.layer) return;
      const key = `${s.layer}->${t.layer}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    });
    const interEdges = Array.from(edgeCounts.entries())
      .map(([k, count]) => {
        const [from, to] = k.split('->');
        return { from, to, count };
      })
      .sort((a, b) => b.count - a.count);

    return { statsByLayer, interEdges };
  }, [graph, nodeMap]);

  const visibleNodes = useMemo(() => {
    if (!graph) return [];
    const q = search.trim().toLowerCase();
    return graph.nodes.filter((n) => {
      if (enabledLayers[n.layer] === false) return false;
      if (!q) return true;
      return (
        n.name.toLowerCase().includes(q) ||
        n.path.toLowerCase().includes(q) ||
        n.summary.toLowerCase().includes(q) ||
        n.symbols.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [graph, enabledLayers, search]);

  const visibleNodeSet = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const visibleEdges = useMemo(() => {
    if (!graph) return [];
    return graph.edges.filter((e) => visibleNodeSet.has(e.source) && visibleNodeSet.has(e.target));
  }, [graph, visibleNodeSet]);

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) || null : null;

  const { outgoingIds, incomingIds } = useMemo(() => {
    const out = new Set<string>();
    const inc = new Set<string>();
    if (selectedNodeId && graph) {
      graph.edges.forEach((e) => {
        if (e.source === selectedNodeId) out.add(e.target);
        if (e.target === selectedNodeId) inc.add(e.source);
      });
    }
    return { outgoingIds: out, incomingIds: inc };
  }, [selectedNodeId, graph]);

  const focusNodeInDetail = useCallback(
    (nid: string) => {
      setSelectedNodeId(nid);
      const n = nodeMap.get(nid);
      if (n) {
        setViewMode('detail');
        setZoom(0.95);
        setPan({ x: Math.max(20, 280 - n.x * 0.95), y: Math.max(20, 200 - n.y * 0.95) });
      }
    },
    [nodeMap],
  );

  const focusSingleLayer = (layerId: string) => {
    if (!graph) return;
    const next: Record<string, boolean> = {};
    graph.layers.forEach((l) => {
      next[l.id] = l.id === layerId;
    });
    setEnabledLayers(next);
    setViewMode('detail');
    const layerOrder = graph.layers.find((l) => l.id === layerId)?.order ?? 0;
    setZoom(1.0);
    setPan({ x: 40 - layerOrder * 280, y: 16 });
  };

  const toggleLayer = (layerId: string) => {
    setEnabledLayers((prev) => ({ ...prev, [layerId]: prev[layerId] === false ? true : false }));
  };

  if (loading && !graph) {
    return (
      <div className="quant-panel p-10 text-center font-mono text-xs uppercase tracking-[0.2em] text-cyan-300">
        Đang quét AST & khởi tạo Bản Đồ Mã Nguồn (Understand-Anything)...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Row 1: 4 Executive KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
        <MetricCard
          className="lg:col-span-3"
          label="Tổng Module Mã Nguồn"
          value={graph?.stats.total_nodes ?? 0}
          tone="cyan"
          icon={<IconServer className="w-4 h-4" />}
          subtext={
            <span className="font-mono tabular-nums">
              Python: <strong className="text-amber-300">{graph?.stats.python_files ?? 0}</strong> · TS/React:{' '}
              <strong className="text-cyan-300">{graph?.stats.ts_files ?? 0}</strong>
            </span>
          }
        />
        <MetricCard
          className="lg:col-span-3"
          label="Liên Kết Phụ Thuộc (Edges)"
          value={graph?.stats.total_edges ?? 0}
          tone="amber"
          icon={<IconActivity className="w-4 h-4" />}
          subtext="Trích xuất AST & Import thực tế 100%"
        />
        <MetricCard
          className="lg:col-span-3"
          label="Tổng Quy Mô Mã (LOC)"
          value={(graph?.stats.total_loc ?? 0).toLocaleString('en-US')}
          tone="emerald"
          icon={<IconTrendingUp className="w-4 h-4" />}
          subtext={`Phân tầng ${graph?.stats.layers_count ?? 6} lớp kiến trúc`}
        />
        <MetricCard
          className="lg:col-span-3"
          label="Understand-Anything Engine"
          value={<span className="text-emerald-400">SCAN → MAP → TEACH</span>}
          tone="emerald"
          icon={<IconShield className="w-4 h-4" />}
          subtext={
            graph?.generated_at
              ? `Cập nhật: ${new Date(graph.generated_at * 1000).toLocaleTimeString('vi-VN')}`
              : 'Sẵn sàng'
          }
        />
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs font-mono text-rose-300">
          Lỗi tải Code Map: {error}
        </div>
      )}

      {/* Row 2: Controls, View Switcher, Layer Filters & Guided Tours */}
      <Panel
        subtitle="UNDERSTAND-ANYTHING // KNOWLEDGE GRAPH"
        title="Bản Đồ Kiến Trúc & Luồng Nghiệp Vụ ZUPIRUS"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Toggle: Overview vs Detail Graph */}
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#040710] p-1 font-mono text-xs">
              <button
                type="button"
                onClick={() => setViewMode('overview')}
                className={`rounded-lg px-3 py-1 font-bold transition cursor-pointer ${
                  viewMode === 'overview'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Tổng Quan 6 Tầng
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('detail');
                  setZoom(0.85);
                  setPan({ x: 24, y: 16 });
                }}
                className={`rounded-lg px-3 py-1 font-bold transition cursor-pointer ${
                  viewMode === 'detail'
                    ? 'bg-cyan-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Chi Tiết ({graph?.stats.total_nodes ?? 0} Modules)
              </button>
            </div>

            {viewMode === 'detail' && (
              <>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))))}
                  className="quant-btn-secondary px-2.5 py-1.5 font-mono text-xs"
                >
                  −
                </button>
                <span className="font-mono text-xs text-slate-300 tabular-nums w-12 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.15).toFixed(2))))}
                  className="quant-btn-secondary px-2.5 py-1.5 font-mono text-xs"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(0.85);
                    setPan({ x: 24, y: 16 });
                    setActiveTourId('');
                    if (graph) {
                      const all: Record<string, boolean> = {};
                      graph.layers.forEach((l) => {
                        all[l.id] = true;
                      });
                      setEnabledLayers(all);
                    }
                  }}
                  className="quant-btn-secondary px-3 py-1.5 font-mono text-xs"
                >
                  Reset View
                </button>
              </>
            )}

            <button
              type="button"
              disabled={rescanning}
              onClick={() => void loadGraph(true)}
              className="quant-btn-primary px-3.5 py-1.5 font-mono text-xs whitespace-nowrap"
            >
              {rescanning ? 'Đang quét AST...' : 'Quét Lại Mã Nguồn (Scan)'}
            </button>
          </div>
        }
        bodyClassName="p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <IconSearch className="w-4 h-4" />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (e.target.value.trim()) setViewMode('detail');
              }}
              placeholder="Tìm file, router, hàm, component..."
              className="quant-input pl-9 font-mono text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(graph?.layers || []).map((l) => {
              const active = enabledLayers[l.id] !== false;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggleLayer(l.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] font-semibold transition cursor-pointer ${
                    active
                      ? 'border-white/20 bg-slate-900/90 text-white'
                      : 'border-white/5 bg-slate-950/50 text-slate-500 opacity-60'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Guided Tours Bar */}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300 mr-1">
            GUIDED TOURS:
          </span>
          {(graph?.tours || []).map((t) => {
            const isSel = activeTourId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  const next = isSel ? '' : t.id;
                  setActiveTourId(next);
                  if (next && t.nodes[0]) {
                    setSelectedNodeId(t.nodes[0]);
                  }
                }}
                className={`rounded-lg border px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                  isSel
                    ? 'border-amber-400/50 bg-amber-500/20 text-amber-200'
                    : 'border-white/10 bg-[#050914] text-slate-300 hover:border-cyan-400/35 hover:text-white'
                }`}
              >
                {t.title}
              </button>
            );
          })}
        </div>

        {activeTour && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-sm text-amber-200">{activeTour.title}</div>
              <StatusBadge tone="warning">{activeTour.nodes.length} mắt xích chính</StatusBadge>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">{activeTour.description}</p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1 font-mono text-[11px]">
              {activeTour.nodes.map((nid, i) => (
                <React.Fragment key={nid}>
                  <button
                    type="button"
                    onClick={() => focusNodeInDetail(nid)}
                    className={`rounded px-2 py-0.5 border transition cursor-pointer ${
                      selectedNodeId === nid
                        ? 'border-amber-300 bg-amber-400 text-slate-950 font-bold'
                        : 'border-amber-400/30 bg-[#040710]/80 text-amber-200 hover:border-amber-300'
                    }`}
                  >
                    {nid.split('/').pop()}
                  </button>
                  {i < activeTour.nodes.length - 1 && <span className="text-amber-400">→</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* Row 3: Interactive Canvas (8 cols) + Node Inspector Drawer (4 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 quant-panel overflow-hidden flex flex-col">
          {viewMode === 'overview' ? (
            <>
              <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5 text-[11px] font-mono text-slate-400">
                <span>
                  Chế độ <strong className="text-amber-300">TỔNG QUAN 6 TẦNG KIẾN TRÚC</strong> — bấm vào tên file để mở Inspector hoặc bấm &ldquo;Xem tầng này&rdquo; để phóng to chi tiết
                </span>
                <span className="hidden sm:inline text-cyan-300">
                  {layerOverview.interEdges.length} luồng liên tầng
                </span>
              </div>

              <div className="p-4 sm:p-5 bg-[#030712] space-y-5">
                {/* Crisp 6-Layer Architecture Map Diagram (SVG with fixed readable aspect ratio) */}
                <div className="rounded-xl border border-white/[0.07] bg-[#050a18] p-3 overflow-x-auto">
                  <svg viewBox="0 0 960 470" className="w-full min-w-[680px] h-auto select-none">
                    <defs>
                      <marker
                        id="ua-arrow"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" fillOpacity="0.7" />
                      </marker>
                    </defs>

                    {/* Inter-Layer Flow Curves */}
                    {layerOverview.interEdges.slice(0, 12).map((ie) => {
                      const p1 = OVERVIEW_POS[ie.from];
                      const p2 = OVERVIEW_POS[ie.to];
                      if (!p1 || !p2) return null;
                      const x1 = p1.x + 130;
                      const y1 = p1.y + 85;
                      const x2 = p2.x + 130;
                      const y2 = p2.y + 85;
                      const mx = (x1 + x2) / 2;
                      const my = (y1 + y2) / 2 - 24;
                      return (
                        <g key={`${ie.from}-${ie.to}`}>
                          <path
                            d={`M ${x1} ${y1} Q ${mx} ${my}, ${x2} ${y2}`}
                            fill="none"
                            stroke={layerColorMap[ie.from] || '#38bdf8'}
                            strokeOpacity={0.45}
                            strokeWidth={Math.min(4, 1.2 + ie.count / 15)}
                            markerEnd="url(#ua-arrow)"
                          />
                          <rect x={mx - 18} y={my - 9} width={36} height={18} rx={9} fill="#0b1224" stroke="#334155" />
                          <text
                            x={mx}
                            y={my + 3}
                            textAnchor="middle"
                            fill="#cbd5e1"
                            fontSize="10"
                            fontWeight="700"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {ie.count}
                          </text>
                        </g>
                      );
                    })}

                    {/* 6 Architectural Layer Blocks */}
                    {(graph?.layers || []).map((l) => {
                      const pos = OVERVIEW_POS[l.id] || { x: 40, y: 40 };
                      const st = layerOverview.statsByLayer[l.id] || { count: 0, loc: 0, topNodes: [] };
                      const hasTourNode =
                        activeTour && st.topNodes.some((n) => tourNodeSet.has(n.id));
                      return (
                        <g
                          key={l.id}
                          transform={`translate(${pos.x}, ${pos.y})`}
                          className="cursor-pointer"
                          onClick={() => focusSingleLayer(l.id)}
                        >
                          <rect
                            width={260}
                            height={172}
                            rx={12}
                            fill="#071022"
                            stroke={hasTourNode ? '#fbbf24' : l.color}
                            strokeWidth={hasTourNode ? 2.5 : 1.5}
                            strokeOpacity={0.85}
                          />
                          <rect width={260} height={36} rx={12} fill={l.color} fillOpacity={0.14} />
                          <circle cx={18} cy={18} r={5} fill={l.color} />
                          <text
                            x={30}
                            y={22}
                            fill="#f8fafc"
                            fontSize="12.5"
                            fontWeight="800"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {l.label.split(' (')[0]}
                          </text>
                          <text
                            x={248}
                            y={22}
                            textAnchor="end"
                            fill={l.color}
                            fontSize="11"
                            fontWeight="700"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {st.count} files
                          </text>

                          <text
                            x={14}
                            y={54}
                            fill="#94a3b8"
                            fontSize="10.5"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {st.loc.toLocaleString('en-US')} dòng mã · Bấm để phóng to tầng
                          </text>

                          {st.topNodes.map((tn, idx) => (
                            <g
                              key={tn.id}
                              transform={`translate(12, ${66 + idx * 24})`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedNodeId(tn.id);
                              }}
                            >
                              <rect
                                width={236}
                                height={20}
                                rx={5}
                                fill={selectedNodeId === tn.id ? 'rgba(251,191,36,0.2)' : 'rgba(15,23,42,0.85)'}
                                stroke={selectedNodeId === tn.id ? '#fbbf24' : 'rgba(148,163,184,0.18)'}
                              />
                              <text
                                x={8}
                                y={13.5}
                                fill={selectedNodeId === tn.id ? '#fde68a' : '#e2e8f0'}
                                fontSize="10.5"
                                fontFamily="JetBrains Mono, monospace"
                              >
                                {tn.name.length > 24 ? `${tn.name.slice(0, 23)}…` : tn.name}
                              </text>
                              <text
                                x={228}
                                y={13.5}
                                textAnchor="end"
                                fill="#94a3b8"
                                fontSize="9.5"
                                fontFamily="JetBrains Mono, monospace"
                              >
                                {tn.loc}L
                              </text>
                            </g>
                          ))}
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* Inter-layer Summary Pills */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {(graph?.layers || []).map((l) => {
                    const st = layerOverview.statsByLayer[l.id] || { count: 0, loc: 0, topNodes: [] };
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => focusSingleLayer(l.id)}
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-[#050914] px-3.5 py-2.5 text-left hover:border-cyan-400/40 transition cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-mono text-xs font-bold text-white truncate">
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                            {l.label}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                            {st.count} modules · {st.loc.toLocaleString('en-US')} LOC
                          </div>
                        </div>
                        <span className="font-mono text-[10px] text-cyan-300 shrink-0 ml-2">Mở →</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5 text-[11px] font-mono text-slate-400">
                <span>
                  Hiển thị <strong className="text-white">{visibleNodes.length}</strong> modules ·{' '}
                  <strong className="text-cyan-300">{visibleEdges.length}</strong> liên kết (kéo chuột để di chuyển · cuộn chuột để zoom)
                </span>
                <div className="hidden sm:flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-amber-300">
                    <span className="h-2 w-2 rounded-full bg-amber-400" /> Import đi
                  </span>
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> Được gọi bởi
                  </span>
                </div>
              </div>

              {/* 1:1 CSS Pixel SVG Canvas — crisp, never squished! */}
              <div
                className="relative h-[620px] w-full overflow-hidden bg-[#030712] cursor-grab active:cursor-grabbing select-none"
                onWheel={(e) => {
                  e.preventDefault();
                  const delta = e.deltaY < 0 ? 0.1 : -0.1;
                  setZoom((z) => Math.min(1.8, Math.max(0.35, Number((z + delta).toFixed(2)))));
                }}
                onMouseDown={(e) => {
                  dragRef.current = {
                    dragging: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: pan.x,
                    origY: pan.y,
                  };
                }}
                onMouseMove={(e) => {
                  if (!dragRef.current.dragging) return;
                  setPan({
                    x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
                    y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
                  });
                }}
                onMouseUp={() => {
                  dragRef.current.dragging = false;
                }}
                onMouseLeave={() => {
                  dragRef.current.dragging = false;
                }}
              >
                <svg width="100%" height="100%" data-testid="understand-code-map-svg">
                  <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                    {/* Architectural Layer Column Headers */}
                    {(graph?.layers || []).map((l) => {
                      if (enabledLayers[l.id] === false) return null;
                      const colX = 90 + l.order * 280;
                      return (
                        <g key={l.id}>
                          <rect
                            x={colX - 18}
                            y={14}
                            width={242}
                            height={36}
                            rx={8}
                            fill="rgba(15, 23, 42, 0.95)"
                            stroke={l.color}
                            strokeOpacity={0.55}
                          />
                          <text
                            x={colX + 103}
                            y={36}
                            textAnchor="middle"
                            fill={l.color}
                            fontSize="12"
                            fontWeight="800"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {l.label}
                          </text>
                        </g>
                      );
                    })}

                    {/* Dependency Edges */}
                    {visibleEdges.map((edge) => {
                      const s = nodeMap.get(edge.source);
                      const t = nodeMap.get(edge.target);
                      if (!s || !t) return null;
                      const isOut = selectedNodeId === edge.source;
                      const isIn = selectedNodeId === edge.target;
                      const isTourEdge =
                        activeTour && tourNodeSet.has(edge.source) && tourNodeSet.has(edge.target);
                      const highlighted = isOut || isIn || isTourEdge;
                      const x1 = s.x + 102;
                      const y1 = s.y + 22;
                      const x2 = t.x + 102;
                      const y2 = t.y + 22;
                      const midX = (x1 + x2) / 2;
                      const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
                      const stroke = isOut
                        ? '#fbbf24'
                        : isIn
                          ? '#34d399'
                          : isTourEdge
                            ? '#f59e0b'
                            : 'rgba(148, 163, 184, 0.16)';
                      return (
                        <path
                          key={`${edge.source}->${edge.target}`}
                          d={d}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={highlighted ? 2.2 : 1}
                          strokeOpacity={highlighted ? 0.92 : selectedNodeId ? 0.08 : 0.28}
                        />
                      );
                    })}

                    {/* Module Nodes */}
                    {visibleNodes.map((n) => {
                      const color = layerColorMap[n.layer] || '#94a3b8';
                      const isSel = selectedNodeId === n.id;
                      const isNeighbor = outgoingIds.has(n.id) || incomingIds.has(n.id);
                      const isInTour = tourNodeSet.has(n.id);
                      const dimmed =
                        (selectedNodeId && !isSel && !isNeighbor) ||
                        (Boolean(activeTour) && !isInTour && !isSel);
                      return (
                        <g
                          key={n.id}
                          transform={`translate(${n.x}, ${n.y})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedNodeId(n.id);
                          }}
                          className="cursor-pointer"
                          opacity={dimmed ? 0.3 : 1}
                        >
                          <rect
                            width={206}
                            height={44}
                            rx={8}
                            fill={isSel ? 'rgba(30, 41, 59, 0.98)' : 'rgba(6, 12, 29, 0.94)'}
                            stroke={isSel ? '#fbbf24' : isInTour ? '#f59e0b' : color}
                            strokeWidth={isSel ? 2.4 : isInTour ? 1.8 : 1.1}
                          />
                          <rect width={4} height={44} rx={2} fill={color} />
                          <text
                            x={12}
                            y={19}
                            fill="#f8fafc"
                            fontSize="11.5"
                            fontWeight="700"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {n.name.length > 23 ? `${n.name.slice(0, 22)}…` : n.name}
                          </text>
                          <text
                            x={12}
                            y={34}
                            fill="#94a3b8"
                            fontSize="9.5"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {n.loc} LOC · in:{n.in_degree} · out:{n.out_degree}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
            </>
          )}
        </div>

        {/* Right 4 Columns: Node Inspector ("Teach") & Hotspots */}
        <div className="lg:col-span-4 space-y-4">
          <Panel
            subtitle="NODE INSPECTOR // TEACH"
            title={selectedNode ? selectedNode.name : 'Chọn một module trên bản đồ'}
            bodyClassName="p-4 space-y-4"
          >
            {selectedNode ? (
              <>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-slate-950"
                        style={{ backgroundColor: layerColorMap[selectedNode.layer] || '#94a3b8' }}
                      >
                        {selectedNode.layer}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {selectedNode.loc} dòng · {selectedNode.language}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => focusNodeInDetail(selectedNode.id)}
                      className="rounded-md border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
                    >
                      Định vị trên Graph
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-cyan-300 break-all">{selectedNode.path}</div>
                  <p className="text-xs text-slate-200 leading-relaxed rounded-lg border border-white/10 bg-[#040710]/80 p-3">
                    {selectedNode.summary}
                  </p>
                </div>

                {selectedNode.symbols.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                      Symbols chính ({selectedNode.symbols.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNode.symbols.map((sym) => (
                        <span
                          key={sym}
                          className="rounded border border-white/10 bg-slate-900/90 px-2 py-0.5 font-mono text-[10px] text-slate-200"
                        >
                          {sym}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
                    Phụ thuộc vào / Imports ({outgoingIds.size})
                  </div>
                  {outgoingIds.size === 0 ? (
                    <div className="text-xs text-slate-500">Không import module nội bộ nào.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {Array.from(outgoingIds).map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setSelectedNodeId(id)}
                          className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-200 hover:bg-amber-500/20 cursor-pointer"
                        >
                          {id.split('/').pop()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                    Được gọi bởi / Dependents ({incomingIds.size})
                  </div>
                  {incomingIds.size === 0 ? (
                    <div className="text-xs text-slate-500">Module đầu vào (entry point).</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {Array.from(incomingIds).map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setSelectedNodeId(id)}
                          className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-200 hover:bg-emerald-500/20 cursor-pointer"
                        >
                          {id.split('/').pop()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400">
                Bấm vào bất kỳ ô module nào trên bản đồ để xem tóm tắt kiến trúc, các hàm export và luồng phụ thuộc.
              </p>
            )}
          </Panel>

          <Panel
            subtitle="ARCHITECTURAL HOTSPOTS"
            title="Top Module Kết Nối Cao Nhất"
            bodyClassName="p-3 space-y-1.5"
          >
            {(graph?.hotspots || []).map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => focusNodeInDetail(h.id)}
                className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left font-mono text-xs transition cursor-pointer ${
                  selectedNodeId === h.id
                    ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                    : 'border-white/[0.06] bg-[#040710]/70 text-slate-300 hover:border-cyan-400/30'
                }`}
              >
                <span className="truncate font-bold">{h.name}</span>
                <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                  in:{h.in_degree} / out:{h.out_degree}
                </span>
              </button>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
};
