#!/usr/bin/env python3
"""CLI Script: Run Out-of-Sample 70/30 Validation (C2).
Evaluates candidate strategies across Standard and Severe fee regimes on 30% strict OOS candles.
"""
import sys
import os

# Ensure repo root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from app.domains.ai.oos_validator import run_oos_validation_suite, generate_benchmark_candles
from app.db import tx


def load_candles_from_db_or_benchmark(symbol: str = "XAUUSD"):
    try:
        with tx() as c:
            rows = c.execute(
                """
                SELECT time, open, high, low, close
                FROM candles
                WHERE UPPER(symbol) = ? AND timeframe = 'M15'
                ORDER BY time ASC
                """,
                (symbol.upper(),),
            ).fetchall()
            if rows and len(rows) >= 500:
                print(f"[OOS] Loaded {len(rows)} real M15 candles for {symbol} from database.")
                return [
                    {
                        "time": r[0] if not hasattr(r, "keys") else r["time"],
                        "open": float(r[1] if not hasattr(r, "keys") else r["open"]),
                        "high": float(r[2] if not hasattr(r, "keys") else r["high"]),
                        "low": float(r[3] if not hasattr(r, "keys") else r["low"]),
                        "close": float(r[4] if not hasattr(r, "keys") else r["close"]),
                    }
                    for r in rows
                ]
    except Exception as exc:
        print(f"[OOS] DB load note: {exc}")

    print(f"[OOS] DB contains < 500 candles. Utilizing 1500-bar benchmark candle series for {symbol}.")
    return generate_benchmark_candles(n_bars=1500, symbol=symbol)


def main():
    symbol = sys.argv[1] if len(sys.argv) > 1 else "XAUUSD"
    candles = load_candles_from_db_or_benchmark(symbol)

    print("\n" + "=" * 80)
    print(f"  ZUPIRUS OUT-OF-SAMPLE 70/30 VALIDATION REPORT — {symbol}")
    print("=" * 80)

    val_res = run_oos_validation_suite(candles, symbol=symbol)

    print(f"\nTotal Candles: {val_res['total_candles']} (In-Sample 70%: {val_res['in_sample_count']} | Out-of-Sample 30%: {val_res['oos_count']})\n")
    print("| Chiến lược | Số lệnh OOS | Net PnL (Chuẩn) | PF (Chuẩn) | Max DD (Chuẩn) | Net PnL (Khắc nghiệt) | Max DD (Khắc nghiệt) | Trạng thái |")
    print("|---|---|---|---|---|---|---|---|")

    for strat_name, data in val_res["results"].items():
        std = data["standard_fee"]
        sev = data["severe_fee"]
        st = data["status"]
        status_badge = "✅ ĐẠT" if st == "QUALIFIED" else "❌ NO_QUALIFIED_STRATEGY"

        print(
            f"| `{strat_name}` | {std['trade_count']} | {std['net_pnl']:+.1f} pips | "
            f"{std['profit_factor']:.2f} | {std['max_drawdown_pct']:.1f}% | "
            f"{sev['net_pnl']:+.1f} pips | {sev['max_drawdown_pct']:.1f}% | {status_badge} |"
        )

    print("\n" + "-" * 80)
    print(f"KẾT LUẬN CUỐI CÙNG: {val_res['conclusion']}")
    print("-" * 80 + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
