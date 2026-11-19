import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MetricCard, Panel, StatusBadge } from './ui/Primitives';
import { IconActivity, IconSearch, IconServer, IconShield, IconTrendingUp } from './Icons';

interface CodeGraphLayer {
  id: string;
  label: string;
  color: string;
  order: number;
  files: number;
  symbols: number;
  routes: number;
  top_files: Array<{
    path: string;
    name: string;
    language: string;
    node_count: number;
    in_edges: number;
    out_edges: number;
  }>;
}

interface SymbolItem {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  layer: string;
  language: string;
  start_line: number;
  end_line: number;
  signature: string;
  docstring: string;
  callers_count?: number;
  callees_count?: number;
  edge_kind?: string;
  call_line?: number;
}

interface CodeGraphOverview {
  engine: string;
  project: string;
  generated_at: number;
  stats: {
    files: number;
    total_nodes: number;
    total_edges: number;
    symbols_indexed: number;
    symbol_edges: number;
    routes_count: number;
    dead_code_count: number;
    languages: Record<string, number>;
    edge_breakdown: Record<string, number>;
  };
  layers: CodeGraphLayer[];
  inter_layer_edges: Array<{ from: string; to: string; count: number }>;
  hotspots: SymbolItem[];
  dead_code: SymbolItem[];
  files_by_layer: Record<string, CodeGraphLayer['top_files']>;
}

interface SymbolQueryResult {
  query: string;
  matches: SymbolItem[];
  selected: SymbolItem | null;
  callers: SymbolItem[];
  callees: SymbolItem[];
  impact: {
    affected_symbols: number;
    affected_files: number;
    files: string[];
  };
}

const LAYER_POS: Record<string, { x: number; y: number }> = {
  frontend: { x: 35, y: 35 },
  api: { x: 345, y: 35 },
  execution: { x: 655, y: 35 },
  ai: { x: 655, y: 265 },
  data: { x: 345, y: 265 },
  ops: { x: 35, y: 265 },
};

const KIND_COLORS: Record<string, string> = {
  function: 'text-cyan-300 border-cyan-500/35 bg-cyan-500/10',
  method: 'text-sky-300 border-sky-500/35 bg-sky-500/10',
  class: 'text-amber-300 border-amber-500/35 bg-amber-500/10',
  route: 'text-emerald-300 border-emerald-500/35 bg-emerald-500/10',
  interface: 'text-purple-300 border-purple-500/35 bg-purple-500/10',
  type_alias: 'text-pink-300 border-pink-500/35 bg-pink-500/10',
};

export const AdminCodeGraphTab: React.FC = () => {
  const [overview, setOverview] = useState<CodeGraphOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subTab, setSubTab] = useState<'map' | 'symbol' | 'hotspots' | 'deadcode'>('map');
  const [selectedLayerId, setSelectedLayerId] = useState<string>('api');

  // Symbol & Call Graph state
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolResult, setSymbolResult] = useState<SymbolQueryResult | null>(null);
  const [symbolLoading, setSymbolLoading] = useState(false);

  const loadOverview = useCallback(async (reindex = false) => {
    try {
      if (reindex) setReindexing(true);
      else setLoading(true);
      setError(null);
      const res = await fetch(
        reindex ? '/api/v1/telemetry/codegraph/reindex' : '/api/v1/telemetry/codegraph',
        {
          method: reindex ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
          credentials: 'include',
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `HTTP ${res.status}`);
      }
      const data: CodeGraphOverview = await res.json();
      setOverview(data);
    } catch (e: any) {
      setError(e?.message || 'Không thể tải dữ liệu CodeGraph');
    } finally {
      setLoading(false);
      setReindexing(false);
    }
  }, []);

  const querySymbol = useCallback(async (q: string, id = '') => {
    try {
      setSymbolLoading(true);
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (id) params.set('id', id);
      const res = await fetch(`/api/v1/telemetry/codegraph/symbol?${params.toString()}`, {
        headers: { 'X-Zupirus': '1' },
        credentials: 'include',
      });
      if (!res.ok) return;
      const data: SymbolQueryResult = await res.json();
      setSymbolResult(data);
    } finally {
      setSymbolLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview(false);
    void querySymbol('');
  }, [loadOverview, querySymbol]);

  const layerColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    (overview?.layers || []).forEach((l) => {
      m[l.id] = l.color;
    });
    return m;
  }, [overview]);

  const inspectSymbol = (sym: SymbolItem) => {
    setSubTab('symbol');
    setSymbolQuery(sym.name);
    void querySymbol(sym.name, sym.id);
  };

  if (loading && !overview) {
    return (
      <div className="quant-panel p-10 text-center font-mono text-xs uppercase tracking-[0.2em] text-cyan-300">
        Đang tải chỉ mục @colbymchenry/codegraph...
      </div>
    );
  }

  const activeLayer = (overview?.layers || []).find((l) => l.id === selectedLayerId) || overview?.layers[0];
  const activeLayerFiles = (activeLayer && overview?.files_by_layer?.[activeLayer.id]) || [];

  return (
    <div className="space-y-6">
      {/* Row 1: 4 Executive KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
        <MetricCard
          className="lg:col-span-3"
          label="Tệp & Symbols (CodeGraph)"
          value={(overview?.stats.total_nodes ?? 0).toLocaleString('en-US')}
          tone="cyan"
          icon={<IconServer className="w-4 h-4" />}
          subtext={
            <span className="font-mono tabular-nums">
              <strong className="text-white">{overview?.stats.files ?? 0}</strong> files ·{' '}
              <strong className="text-cyan-300">{overview?.stats.symbols_indexed ?? 0}</strong> hàm/class/route
            </span>
          }
        />
        <MetricCard
          className="lg:col-span-3"
          label="Call Graph & Edges"
          value={(overview?.stats.total_edges ?? 0).toLocaleString('en-US')}
          tone="amber"
          icon={<IconActivity className="w-4 h-4" />}
          subtext={
            <span className="font-mono tabular-nums">
              Calls: <strong className="text-amber-300">{overview?.stats.edge_breakdown?.calls ?? 0}</strong> · Imports:{' '}
              <strong className="text-emerald-300">{overview?.stats.edge_breakdown?.imports ?? 0}</strong>
            </span>
          }
        />
        <MetricCard
          className="lg:col-span-3"
          label="FastAPI Routes & Dead Code"
          value={overview?.stats.routes_count ?? 0}
          tone="emerald"
          icon={<IconTrendingUp className="w-4 h-4" />}
          subtext={
            <span className="font-mono tabular-nums">
              Dead code gợi ý: <strong className="text-rose-300">{overview?.stats.dead_code_count ?? 0}</strong>
            </span>
          }
        />
        <MetricCard
          className="lg:col-span-3"
          label="Semantic Engine"
          value={<span className="text-emerald-400">CODEGRAPH v1.6</span>}
          tone="emerald"
          icon={<IconShield className="w-4 h-4" />}
          subtext="colbymchenry/codegraph · Rust/Tree-sitter"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs font-mono text-rose-300">
          Lỗi tải CodeGraph: {error}
        </div>
      )}

      {/* Row 2: View Switcher & Quick Symbol Search */}
      <Panel
        subtitle="COLBYMCHENRY/CODEGRAPH // SEMANTIC CODE INTELLIGENCE"
        title="Bản Đồ Mã Nguồn, Call Graph & Phân Tích Tác Động (Impact Radius)"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#040710] p-1 font-mono text-xs">
              {(
                [
                  ['map', 'Tổng Quan Kiến Trúc'],
                  ['symbol', 'Call Graph & Impact'],
                  ['hotspots', 'Hotspots'],
                  ['deadcode', `Dead Code (${overview?.stats.dead_code_count ?? 0})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSubTab(key)}
                  className={`rounded-lg px-3 py-1.5 font-bold transition whitespace-nowrap cursor-pointer ${
                    subTab === key ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={reindexing}
              onClick={() => void loadOverview(true)}
              className="quant-btn-primary px-3.5 py-1.5 font-mono text-xs whitespace-nowrap"
            >
              {reindexing ? 'Đang Re-index...' : 'Cập Nhật Index'}
            </button>
          </div>
        }
        bodyClassName="p-4 sm:p-5"
      >
        {/* SUB-VIEW 1: CRISP 6-LAYER ARCHITECTURE MAP */}
        {subTab === 'map' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-xl border border-white/[0.08] bg-[#040814] p-3 overflow-x-auto">
              <svg viewBox="0 0 960 470" className="w-full min-w-[680px] h-auto select-none" data-testid="codegraph-map-svg">
                <defs>
                  <marker
                    id="cg-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" fillOpacity="0.75" />
                  </marker>
                </defs>

                {(overview?.inter_layer_edges || []).slice(0, 14).map((ie) => {
                  const p1 = LAYER_POS[ie.from];
                  const p2 = LAYER_POS[ie.to];
                  if (!p1 || !p2) return null;
                  const x1 = p1.x + 135;
                  const y1 = p1.y + 85;
                  const x2 = p2.x + 135;
                  const y2 = p2.y + 85;
                  const mx = (x1 + x2) / 2;
                  const my = (y1 + y2) / 2 - 22;
                  const active = selectedLayerId === ie.from || selectedLayerId === ie.to;
                  return (
                    <g key={`${ie.from}->${ie.to}`}>
                      <path
                        d={`M ${x1} ${y1} Q ${mx} ${my}, ${x2} ${y2}`}
                        fill="none"
                        stroke={layerColorMap[ie.from] || '#38bdf8'}
                        strokeOpacity={active ? 0.85 : 0.25}
                        strokeWidth={Math.min(4.2, 1.2 + ie.count / 60)}
                        markerEnd="url(#cg-arrow)"
                      />
                      <rect x={mx - 20} y={my - 9} width={40} height={18} rx={9} fill="#0b1224" stroke="#334155" />
                      <text
                        x={mx}
                        y={my + 3}
                        textAnchor="middle"
                        fill={active ? '#fde68a' : '#94a3b8'}
                        fontSize="10"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {ie.count}
                      </text>
                    </g>
                  );
                })}

                {(overview?.layers || []).map((l) => {
                  const pos = LAYER_POS[l.id] || { x: 35, y: 35 };
                  const isSel = selectedLayerId === l.id;
                  return (
                    <g
                      key={l.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onClick={() => setSelectedLayerId(l.id)}
                      className="cursor-pointer"
                    >
                      <rect
                        width={270}
                        height={176}
                        rx={12}
                        fill="#071022"
                        stroke={isSel ? '#fbbf24' : l.color}
                        strokeWidth={isSel ? 2.5 : 1.4}
                      />
                      <rect width={270} height={36} rx={12} fill={l.color} fillOpacity={0.14} />
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
                        x={258}
                        y={22}
                        textAnchor="end"
                        fill={l.color}
                        fontSize="10.5"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {l.files} files · {l.symbols} sym
                      </text>

                      {l.top_files.slice(0, 5).map((tf, idx) => (
                        <g key={tf.path} transform={`translate(12, ${46 + idx * 24})`}>
                          <rect
                            width={246}
                            height={20}
                            rx={5}
                            fill="rgba(15,23,42,0.88)"
                            stroke="rgba(148,163,184,0.16)"
                          />
                          <text
                            x={8}
                            y={13.5}
                            fill="#e2e8f0"
                            fontSize="10.5"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {tf.name.length > 24 ? `${tf.name.slice(0, 23)}…` : tf.name}
                          </text>
                          <text
                            x={238}
                            y={13.5}
                            textAnchor="end"
                            fill="#94a3b8"
                            fontSize="9.5"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            in:{tf.in_edges} out:{tf.out_edges}
                          </text>
                        </g>
                      ))}
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="lg:col-span-4 rounded-xl border border-white/[0.08] bg-[#040814] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
                    CHI TIẾT TẦNG KIẾN TRÚC
                  </div>
                  <div className="font-bold text-sm text-white">{activeLayer?.label}</div>
                </div>
                <StatusBadge tone="info">{activeLayer?.files ?? 0} files</StatusBadge>
              </div>
              <div className="space-y-1.5 max-h-[410px] overflow-y-auto pr-1">
                {activeLayerFiles.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => {
                      setSubTab('symbol');
                      setSymbolQuery(f.name.replace(/\.(py|ts|tsx)$/, ''));
                      void querySymbol(f.name.replace(/\.(py|ts|tsx)$/, ''));
                    }}
                    className="w-full flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#071022] px-3 py-2 text-left font-mono text-xs hover:border-cyan-400/40 transition cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-slate-100 truncate">{f.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">{f.path}</div>
                    </div>
                    <span className="text-[10px] text-cyan-300 shrink-0 ml-2">
                      {f.node_count} sym
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SUB-VIEW 2: SYMBOL SEARCH, CALL GRAPH & 2-HOP IMPACT RADIUS */}
        {subTab === 'symbol' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-4 space-y-3">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <IconSearch className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={symbolQuery}
                  onChange={(e) => {
                    setSymbolQuery(e.target.value);
                    void querySymbol(e.target.value);
                  }}
                  placeholder="Tìm hàm, class, route (VD: fanout, tx, calculate_lot)..."
                  className="quant-input pl-9 font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
                {(symbolResult?.matches || []).map((m) => {
                  const isSel = symbolResult?.selected?.id === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => void querySymbol(symbolQuery, m.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition cursor-pointer ${
                        isSel
                          ? 'border-amber-400/60 bg-amber-500/15'
                          : 'border-white/[0.06] bg-[#040814] hover:border-cyan-400/35'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-white truncate">{m.name}</span>
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                            KIND_COLORS[m.kind] || 'text-slate-300 border-white/10'
                          }`}
                        >
                          {m.kind}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-400">
                        <span className="truncate">{m.file_path}:{m.start_line}</span>
                        <span className="shrink-0 ml-2 text-cyan-300">
                          ↑{m.callers_count ?? 0} ↓{m.callees_count ?? 0}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-8 space-y-4">
              {symbolLoading && !symbolResult?.selected ? (
                <div className="p-8 text-center font-mono text-xs text-slate-400">Đang truy vấn Call Graph...</div>
              ) : symbolResult?.selected ? (
                <>
                  <div className="rounded-xl border border-amber-400/35 bg-[#040814] p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                            KIND_COLORS[symbolResult.selected.kind] || 'text-slate-200 border-white/15'
                          }`}
                        >
                          {symbolResult.selected.kind}
                        </span>
                        <h4 className="font-mono text-base font-extrabold text-amber-300">
                          {symbolResult.selected.name}
                        </h4>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <StatusBadge tone="warning">
                          Impact Radius (2-hop): {symbolResult.impact.affected_symbols} symbols / {symbolResult.impact.affected_files} files
                        </StatusBadge>
                      </div>
                    </div>
                    <div className="font-mono text-xs text-cyan-300">
                      {symbolResult.selected.file_path} · dòng {symbolResult.selected.start_line}–{symbolResult.selected.end_line}
                    </div>
                    {symbolResult.selected.signature && (
                      <pre className="rounded-lg border border-white/10 bg-[#02050d] p-2.5 font-mono text-[11px] text-slate-200 overflow-x-auto">
                        {symbolResult.selected.signature}
                      </pre>
                    )}
                    {symbolResult.selected.docstring && (
                      <p className="text-xs text-slate-300">{symbolResult.selected.docstring}</p>
                    )}
                  </div>

                  {/* Call Graph 2-Column Tree: Callers vs Callees */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-emerald-500/25 bg-[#040814] p-4 space-y-2.5">
                      <div className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-300">
                        ↑ Callers — Ai Gọi Symbol Này ({symbolResult.callers.length})
                      </div>
                      {symbolResult.callers.length === 0 ? (
                        <div className="text-xs text-slate-500">Không có caller trực tiếp (entry point / route).</div>
                      ) : (
                        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                          {symbolResult.callers.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => inspectSymbol(c)}
                              className="w-full rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-left font-mono text-xs hover:border-emerald-400/50 transition cursor-pointer"
                            >
                              <div className="font-bold text-emerald-200 truncate">{c.name}</div>
                              <div className="text-[10px] text-slate-400 truncate">
                                {c.file_path}:{c.call_line || c.start_line} ({c.edge_kind})
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-amber-500/25 bg-[#040814] p-4 space-y-2.5">
                      <div className="font-mono text-xs font-bold uppercase tracking-wider text-amber-300">
                        ↓ Callees — Symbol Này Gọi Tới ({symbolResult.callees.length})
                      </div>
                      {symbolResult.callees.length === 0 ? (
                        <div className="text-xs text-slate-500">Hàm lá (leaf function), không gọi symbol nội bộ khác.</div>
                      ) : (
                        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                          {symbolResult.callees.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => inspectSymbol(c)}
                              className="w-full rounded-lg border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-left font-mono text-xs hover:border-amber-400/50 transition cursor-pointer"
                            >
                              <div className="font-bold text-amber-200 truncate">{c.name}</div>
                              <div className="text-[10px] text-slate-400 truncate">
                                {c.file_path}:{c.start_line} ({c.edge_kind})
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-8 text-center text-xs text-slate-400">
                  Nhập tên hàm/class/route ở ô tìm kiếm bên trái để xem Call Graph và phạm vi ảnh hưởng (Impact Radius).
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUB-VIEW 3: HOTSPOTS */}
        {subTab === 'hotspots' && (
          <div className="overflow-x-auto">
            <table className="quant-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Loại</th>
                  <th>Đường Dẫn</th>
                  <th className="text-right">Callers (Được gọi)</th>
                  <th className="text-right">Callees (Gọi đi)</th>
                  <th className="text-right">Hành Động</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.hotspots || []).map((h) => (
                  <tr key={h.id}>
                    <td className="font-mono font-bold text-amber-300">{h.name}</td>
                    <td>
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${KIND_COLORS[h.kind] || ''}`}>
                        {h.kind}
                      </span>
                    </td>
                    <td className="font-mono text-xs text-slate-300">
                      {h.file_path}:{h.start_line}
                    </td>
                    <td className="text-right font-mono font-bold text-emerald-300">{h.callers_count}</td>
                    <td className="text-right font-mono text-cyan-300">{h.callees_count}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => inspectSymbol(h)}
                        className="quant-btn-secondary px-2.5 py-1 font-mono text-[11px]"
                      >
                        Xem Call Graph →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* SUB-VIEW 4: DEAD CODE CANDIDATES */}
        {subTab === 'deadcode' && (
          <div className="space-y-3">
            <div className="text-xs text-slate-400">
              Các hàm/class có <strong className="text-rose-300">0 caller trực tiếp</strong> trong chỉ mục CodeGraph (đã loại trừ route FastAPI, test và entry point):
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(overview?.dead_code || []).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => inspectSymbol(d)}
                  className="rounded-xl border border-white/[0.07] bg-[#040814] p-3 text-left hover:border-rose-400/40 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-rose-200 truncate">{d.name}</span>
                    <span className="font-mono text-[10px] uppercase text-slate-400">{d.kind}</span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-slate-400 truncate">
                    {d.file_path}:{d.start_line}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
};
