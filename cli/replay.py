"""ZUPIRUS Quant Lab - Standalone Quantitative Replay & Verification Tool.

Enables institutional client teams to locally replay Breakout & Retest quantitative rules
on COMEX Gold Futures or custom client candle files with zero broker dependencies.

Usage:
  python -m cli.replay --input data/samples/comex_gold_m15_sample.csv
  python -m cli.replay --input <client_candles.csv> --spread-pips 3.5 --slippage-pips 1.0 --output-ledger ledger.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.domains.quant.candles import Candle, normalize_candles
from app.domains.quant.data_feed import build_dataset_identity, compute_candles_sha256
from app.domains.quant.studies import rule_backtest, generate_ledger_csv


def parse_candle_file(file_path: Path) -> Tuple[List[Candle], Dict[str, Any]]:
    """Parse CSV or JSON candle file with strict validation and duplicate checking."""
    if not file_path.exists():
        raise FileNotFoundError(f"Tệp dữ liệu không tồn tại: {file_path}")

    raw_candles = []
    seen_timestamps = set()
    duplicate_count = 0

    if file_path.suffix.lower() == ".json":
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, list):
                raise ValueError("JSON dữ liệu nến phải là một danh sách các bản ghi (list of objects).")
            for item in data:
                ts = int(item.get("time") or item.get("timestamp") or 0)
                if ts in seen_timestamps:
                    duplicate_count += 1
                    continue
                seen_timestamps.add(ts)
                raw_candles.append({
                    "time": ts,
                    "open": float(item["open"]),
                    "high": float(item["high"]),
                    "low": float(item["low"]),
                    "close": float(item["close"]),
                    "volume": float(item.get("volume", 100)),
                })
    else:
        # CSV parsing
        with open(file_path, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip() and not line.startswith("#")]
        if not lines:
            raise ValueError(f"Tệp CSV rỗng hoặc chỉ chứa chú thích: {file_path}")

        reader = csv.DictReader(lines)
        fieldnames = [fn.lower().strip() for fn in (reader.fieldnames or [])]
        
        # Check required columns
        for req in ("time", "open", "high", "low", "close"):
            if not any(req in fn for fn in fieldnames):
                # Try finding timestamp
                if req == "time" and any("date" in fn or "timestamp" in fn for fn in fieldnames):
                    continue
                raise ValueError(f"Tệp CSV thiếu cột bắt buộc '{req}'. Cần có: time, open, high, low, close.")

        for row in reader:
            normalized_row = {k.lower().strip(): v.strip() for k, v in row.items() if k}
            # Time resolution
            raw_t = normalized_row.get("time") or normalized_row.get("timestamp")
            if not raw_t and "datetime" in normalized_row:
                dt_str = normalized_row["datetime"]
                try:
                    # Clean UTC if present
                    clean_dt = dt_str.replace("UTC", "").strip()
                    dt = datetime.fromisoformat(clean_dt).replace(tzinfo=timezone.utc)
                    ts = int(dt.timestamp())
                except Exception:
                    continue
            else:
                try:
                    ts = int(float(raw_t))
                except (ValueError, TypeError):
                    continue

            if ts in seen_timestamps:
                duplicate_count += 1
                continue
            seen_timestamps.add(ts)

            try:
                o_f = float(normalized_row["open"])
                h_f = float(normalized_row["high"])
                l_f = float(normalized_row["low"])
                c_f = float(normalized_row["close"])
                v_f = float(normalized_row.get("volume") or 100.0)
            except (ValueError, TypeError):
                continue

            raw_candles.append({
                "time": ts,
                "open": o_f,
                "high": h_f,
                "low": l_f,
                "close": c_f,
                "volume": v_f,
            })

    if not raw_candles:
        raise ValueError(f"Không thể đọc được cây nến hợp lệ nào từ tệp: {file_path}")

    # Sort deterministically by timestamp
    raw_candles.sort(key=lambda x: x["time"])
    candles = normalize_candles(raw_candles)

    validation_meta = {
        "file_name": file_path.name,
        "raw_count": len(raw_candles),
        "valid_candles_count": len(candles),
        "duplicate_timestamps_dropped": duplicate_count,
        "earliest_ts": candles[0].time if candles else None,
        "latest_ts": candles[-1].time if candles else None,
        "earliest_iso": candles[0].utc.strftime("%Y-%m-%d %H:%M:%S UTC") if candles else "N/A",
        "latest_iso": candles[-1].utc.strftime("%Y-%m-%d %H:%M:%S UTC") if candles else "N/A",
    }
    return candles, validation_meta


def run_standalone_replay(
    candles: List[Candle],
    symbol: str = "GC=F",
    timeframe: str = "M15",
    spread_pips: float = 3.5,
    slippage_pips: float = 1.0,
) -> Dict[str, Any]:
    """Execute the locked Breakout & Retest quantitative study on candles and generate verifiable ledger."""
    # Convert pips into R-cost assumption
    # On Gold M15, average risk is ~100 pips ($10.0/oz). 3.5 pips spread + 1.0 pip slippage = 4.5 pips = 0.045R
    total_cost_pips = spread_pips + slippage_pips
    cost_r = round(total_cost_pips / 100.0, 4)

    # Build dataset identity
    ds_identity = build_dataset_identity(symbol=symbol, timeframe=timeframe, candles=candles)

    # Run deterministic study
    study_res = rule_backtest(candles, round_trip_cost_r=cost_r)

    # Extract metrics from table
    t_rows = dict(study_res.get("table", {}).get("rows", []))

    return {
        "dataset_identity": ds_identity.to_dict(),
        "total_candles": len(candles),
        "parameters": {
            "symbol": symbol,
            "timeframe": timeframe,
            "strategy": "Breakout & Retest M15 (ZUPIRUS Gold Research Suite v1)",
            "spread_pips": spread_pips,
            "slippage_pips": slippage_pips,
            "total_friction_pips": total_cost_pips,
            "friction_cost_r": cost_r,
            "conservative_same_bar_sl": True,
            "time_stop_bars": 32,
            "session_close_exit_utc": "21:00 UTC",
        },
        "summary": {
            "trades": t_rows.get("trades", 0),
            "win_rate_pct": round(float(t_rows.get("win_rate") or 0.0) * 100, 2),
            "profit_factor": t_rows.get("profit_factor"),
            "profit_factor_label": t_rows.get("profit_factor_label"),
            "expectancy_r": t_rows.get("expectancy_r"),
            "max_drawdown_r": t_rows.get("max_drawdown_r"),
            "sum_r": t_rows.get("sum_r"),
            "sharpe_ratio": t_rows.get("sharpe_ratio"),
            "sortino_ratio": t_rows.get("sortino_ratio"),
            "calmar_ratio": t_rows.get("calmar_ratio"),
            "t_statistic": t_rows.get("t_statistic"),
            "p_value": t_rows.get("p_value"),
        },
        "split_breakdown": study_res.get("split_breakdown", {}),
        "session_breakdown": study_res.get("session_breakdown", {}),
        "trades": study_res.get("trades", []),
        "ledger_csv": study_res.get("ledger_csv", ""),
        "equity_series": study_res.get("equity_series", []),
        "drawdown_series": study_res.get("drawdown_series", []),
        "cost_stress_matrix": study_res.get("cost_stress_matrix", {}),
        "monte_carlo_risk": study_res.get("monte_carlo_risk", {}),
    }


def print_cli_report(res: Dict[str, Any], validation_meta: Dict[str, Any]) -> None:
    """Pretty-print terminal executive dashboard."""
    ds = res["dataset_identity"]
    p = res["parameters"]
    s = res["summary"]

    print("=" * 78)
    print("  ZUPIRUS QUANT LAB - GOLD RESEARCH SUITE V1 REPLAY DESK")
    print("  Quantitative Breakout & Retest M15 Backtest & Deterministic Ledger")
    print("=" * 78)
    print(f" Asset Class       : {ds['asset_class']}")
    print(f" Symbol (Source)   : {ds['symbol']} ({ds['symbol_display']})")
    print(f" Provider / Source : {ds['provider']}")
    print(f" Timeframe / Zone  : {ds['timeframe']} / {ds['timezone']}")
    print(f" Sample Window     : {validation_meta['earliest_iso']}  ->  {validation_meta['latest_iso']}")
    print(f" Total Candles     : {validation_meta['valid_candles_count']} bars (deduped {validation_meta['duplicate_timestamps_dropped']} duplicates)")
    print(f" Dataset SHA-256   : {ds['data_sha256']}")
    print("-" * 78)
    print(f" Execution Model   : Point-in-time Open Entry after Retest Confirmation")
    print(f" Assumptions       : Spread {p['spread_pips']} pips | Slippage {p['slippage_pips']} pips | Cost {p['friction_cost_r']}R")
    print(f" Safeguards        : Same-bar SL/TP conservative (SL first) | Time stop 32 bars / 21:00 UTC")
    print("=" * 78)
    print("  EXECUTIVE QUANTITATIVE PERFORMANCE SUMMARY")
    print("-" * 78)
    print(f" Total Trades (N)  : {s['trades']:<10} | Win Rate (%)       : {s['win_rate_pct']}%")
    print(f" Profit Factor     : {s['profit_factor_label']:<10} | Expectancy (R)     : {s['expectancy_r']:+.4f}R")
    print(f" Net Realized (R)  : {s['sum_r']:<10.2f}R | Max Drawdown (R)   : {s['max_drawdown_r']:.2f}R")
    print(f" Sharpe Ratio      : {s['sharpe_ratio']:<10} | Sortino Ratio      : {s['sortino_ratio']}")
    print(f" Student's t-stat  : {s['t_statistic']:<10} | Two-tailed p-value : {s['p_value']}")
    print("-" * 78)

    # Print Split sets
    splits = res.get("split_breakdown", {})
    if splits:
        print("  DATASET SEGMENTATION (OUT-OF-SAMPLE VERIFICATION)")
        print(f"  {'Split Segment':<15} {'Trades':<8} {'Win Rate':<12} {'Net R':<10} {'Expectancy':<12} {'Profit Factor'}")
        print("  " + "-" * 70)
        for s_name, s_data in splits.items():
            pf_disp = f"{s_data['profit_factor']:.2f}" if s_data.get('profit_factor') is not None else "N/A"
            print(f"  {s_name:<15} {s_data['trades']:<8} {s_data['win_rate']*100:<10.1f}% {s_data['sum_r']:<10.2f}R {s_data['expectancy_r']:<+11.3f}R {pf_disp}")
        print("-" * 78)

    # Print first few trades
    trades = res.get("trades", [])
    if trades:
        print(f"  SAMPLE TRANSACTION LEDGER (Displaying first 5 of {len(trades)} trades)")
        print(f"  {'ID':<8} {'Side':<6} {'Entry UTC':<20} {'Entry':<10} {'Exit':<10} {'Reason':<14} {'Net R'}")
        print("  " + "-" * 72)
        for t in trades[:5]:
            print(f"  {t['trade_id']:<8} {t['side']:<6} {t['entry_datetime'][:19]:<20} {t['entry_price']:<10.2f} {t['exit_price']:<10.2f} {t['exit_reason']:<14} {t['net_r']:+.3f}R")
        print("=" * 78)


def main():
    parser = argparse.ArgumentParser(description="ZUPIRUS Quant Lab - Standalone Replay & Verification Tool")
    parser.add_argument("--input", "-i", type=str, default="data/samples/comex_gold_m15_sample.csv", help="Path to input candle CSV or JSON file")
    parser.add_argument("--symbol", "-s", type=str, default="GC=F", help="Asset symbol (default: GC=F COMEX Gold Futures)")
    parser.add_argument("--timeframe", "-tf", type=str, default="M15", help="Timeframe (default: M15)")
    parser.add_argument("--spread-pips", type=float, default=3.5, help="Assumed spread in pips (default: 3.5)")
    parser.add_argument("--slippage-pips", type=float, default=1.0, help="Assumed slippage in pips (default: 1.0)")
    parser.add_argument("--output-ledger", "-o", type=str, default=None, help="Path to write output transaction ledger CSV")
    parser.add_argument("--output-json", type=str, default=None, help="Path to write full execution bundle JSON")
    parser.add_argument("--json", action="store_true", help="Output summary as JSON to stdout")

    args = parser.parse_args()

    input_path = Path(args.input)
    candles, validation_meta = parse_candle_file(input_path)

    replay_result = run_standalone_replay(
        candles=candles,
        symbol=args.symbol,
        timeframe=args.timeframe,
        spread_pips=args.spread_pips,
        slippage_pips=args.slippage_pips,
    )

    if args.output_ledger:
        out_ledger_path = Path(args.output_ledger)
        out_ledger_path.parent.mkdir(parents=True, exist_ok=True)
        out_ledger_path.write_text(replay_result["ledger_csv"], encoding="utf-8")
        if not args.json:
            print(f"Saved complete transaction ledger to: {out_ledger_path}")

    if args.output_json:
        out_json_path = Path(args.output_json)
        out_json_path.parent.mkdir(parents=True, exist_ok=True)
        out_json_path.write_text(json.dumps(replay_result, indent=2, ensure_ascii=False), encoding="utf-8")
        if not args.json:
            print(f"Saved execution bundle JSON to: {out_json_path}")

    if args.json:
        # Output clean JSON to stdout
        clean_out = {
            "validation_meta": validation_meta,
            "dataset_identity": replay_result["dataset_identity"],
            "parameters": replay_result["parameters"],
            "summary": replay_result["summary"],
            "split_breakdown": replay_result["split_breakdown"],
            "session_breakdown": replay_result["session_breakdown"],
            "trades_count": len(replay_result["trades"]),
        }
        print(json.dumps(clean_out, indent=2, ensure_ascii=False))
    else:
        print_cli_report(replay_result, validation_meta)


if __name__ == "__main__":
    main()
