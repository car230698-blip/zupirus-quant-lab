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

export const AdminCodeMapTab: React.FC = () => {
  const [graph, setGraph] = useState<CodeGraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>({});
  const [activeTourId, setActiveTourId] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Pan & Zoom state for interactive SVG canvas
  const [zoom, setZoom] = useState(0.72);
  const [pan, setPan] = useState({ x: 20, y: 12 });
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

  const canvasBounds = useMemo(() => {
    let maxX = 1800;
    let maxY = 900;
    visibleNodes.forEach((n) => {
      if (n.x + 260 > maxX) maxX = n.x + 260;
      if (n.y + 120 > maxY) maxY = n.y + 120;
    });
    return { width: maxX, height: maxY };
  }, [visibleNodes]);

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

      {/* Row 2: Controls, Layer Filters & Guided Tours */}
      <Panel
        subtitle="UNDERSTAND-ANYTHING // KNOWLEDGE GRAPH"
        title="Bản Đồ Kiến Trúc & Luồng Nghiệp Vụ ZUPIRUS"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.35, Number((z - 0.12).toFixed(2))))}
              className="quant-btn-secondary px-2.5 py-1.5 font-mono text-xs"
            >
              −
            </button>
            <span className="font-mono text-xs text-slate-300 tabular-nums w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.12).toFixed(2))))}
              className="quant-btn-secondary px-2.5 py-1.5 font-mono text-xs"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(0.72);
                setPan({ x: 20, y: 12 });
                setActiveTourId('');
              }}
              className="quant-btn-secondary px-3 py-1.5 font-mono text-xs"
            >
              Reset View
            </button>
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
              onChange={(e) => setSearch(e.target.value)}
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
                  if (next && t.nodes[0]) setSelectedNodeId(t.nodes[0]);
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
                    onClick={() => setSelectedNodeId(nid)}
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

      {/* Row 3: Interactive SVG Canvas (8 cols) + Node Inspector Drawer (4 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 quant-panel overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5 text-[11px] font-mono text-slate-400">
            <span>
              Hiển thị <strong className="text-white">{visibleNodes.length}</strong> modules ·{' '}
              <strong className="text-cyan-300">{visibleEdges.length}</strong> liên kết (kéo chuột để di chuyển)
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

          <div
            className="relative h-[560px] w-full overflow-hidden bg-[#030712] cursor-grab active:cursor-grabbing select-none"
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
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${canvasBounds.width} ${canvasBounds.height}`}
              data-testid="understand-code-map-svg"
            >
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
                        fill="rgba(15, 23, 42, 0.9)"
                        stroke={l.color}
                        strokeOpacity={0.45}
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
                  if (selectedNodeId && !highlighted && !activeTour) {
                    // Dim unrelated edges heavily for clarity
                  }
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
                        : 'rgba(148, 163, 184, 0.14)';
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
                        fill={isSel ? 'rgba(30, 41, 59, 0.98)' : 'rgba(6, 12, 29, 0.92)'}
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
                  <div className="flex flex-wrap items-center gap-2">
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
                onClick={() => setSelectedNodeId(h.id)}
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
