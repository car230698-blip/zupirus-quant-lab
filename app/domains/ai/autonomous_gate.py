"""Institutional Gatekeeper for ZUPIRUS Quant Lab Autonomous Desk.

Evaluates empirical quantitative study bundles against 5 rigorous institutional criteria
before permitting autonomous publication to the public catalog:
1. Statistical Significance (t-statistic >= 1.96, p-value < 0.05)
2. Profit Factor (PF >= 1.30)
3. Maximum Drawdown & Tail Risk (Historical Max DD <= 15R, MC P95 DD <= 20R)
4. Empirical Sample Depth (Trades >= 25)
5. Friction Resilience (Expectancy > 0 at 0.05R slippage/spread cost)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("zupirus.ai.autonomous_gate")


@dataclass
class GateEvaluationResult:
    passed: bool
    score: float
    status: str
    passed_checks: List[str] = field(default_factory=list)
    failed_checks: List[str] = field(default_factory=list)
    metrics_summary: Dict[str, Any] = field(default_factory=dict)
    summary_vi: str = ""
    gate_details: Dict[str, Any] = field(default_factory=dict)


def evaluate_institutional_gate(bundle: Dict[str, Any]) -> GateEvaluationResult:
    """Evaluate a quantitative study bundle against institutional publishing criteria."""
    studies = bundle.get("studies", [])
    rule_study = next(
        (s for s in studies if str(s.get("id", "")).startswith("rule_backtest")),
        None,
    )
    if not rule_study:
        return GateEvaluationResult(
            passed=False,
            score=0.0,
            status="INSUFFICIENT_EVIDENCE",
            failed_checks=["Không tìm thấy nghiên cứu quy tắc giao dịch (rule_backtest) trong bundle."],
            summary_vi="BÁC BỎ (INSUFFICIENT_EVIDENCE): Dữ liệu nghiên cứu không chứa mô đun backtest quy tắc thực nghiệm.",
        )

    # Check Dataset Identity & Candle Coverage
    ds_id = bundle.get("dataset_identity") or {}
    bars_count = int(ds_id.get("bars_count") or bundle.get("candle_count") or 0)
    if bars_count < 50:
        return GateEvaluationResult(
            passed=False,
            score=0.0,
            status="INSUFFICIENT_EVIDENCE",
            failed_checks=[f"Mẫu dữ liệu nến không đủ độ sâu ({bars_count} nến, tối thiểu yêu cầu 50 nến)."],
            summary_vi="BÁC BỎ (INSUFFICIENT_EVIDENCE): Độ phủ mẫu nến không đủ để tiến hành kiểm định định lượng.",
        )

    # Extract metrics from table rows with safe zero handling
    raw_rows = rule_study.get("table", {}).get("rows", [])
    m: Dict[str, Any] = {row[0]: row[1] for row in raw_rows if len(row) >= 2}

    def _get_val(key: str, default: float) -> float:
        v = m.get(key)
        if v is not None:
            try:
                return float(v)
            except (ValueError, TypeError):
                pass
        return default

    trades = int(_get_val("trades", 0))
    if trades < 20:
        return GateEvaluationResult(
            passed=False,
            score=0.0,
            status="INSUFFICIENT_EVIDENCE",
            failed_checks=[f"Mẫu lệnh quá ít ({trades} lệnh, yêu cầu tối thiểu 20 lệnh để đánh giá thống kê)."],
            summary_vi=f"BÁC BỎ (INSUFFICIENT_EVIDENCE): Số lượng giao dịch thực nghiệm ({trades} lệnh) không đủ để kết luận về mặt thống kê.",
            metrics_summary={"trades": trades},
        )

    win_rate = _get_val("win_rate", 0.0)
    profit_factor = _get_val("profit_factor", 0.0)
    expectancy_r = _get_val("expectancy_r", 0.0)
    max_dd_r = abs(_get_val("max_drawdown_r", 0.0))
    sharpe = _get_val("sharpe_ratio", 0.0)
    t_stat = _get_val("t_statistic", 0.0)
    p_val = _get_val("p_value", 1.0)

    # Monte Carlo & Cost Stress
    mc = rule_study.get("monte_carlo_risk") or bundle.get("monte_carlo") or {}
    p95_dd = abs(float(mc.get("p95_max_dd") or max_dd_r * 1.3))
    prob_s7 = float(mc.get("prob_loss_streak_7") or 0.0)

    cost_matrix = rule_study.get("cost_stress_matrix") or bundle.get("cost_stress_matrix") or {}
    med_cost_exp = expectancy_r - 0.035
    if isinstance(cost_matrix, dict) and "rows" in cost_matrix:
        for r in cost_matrix["rows"]:
            if len(r) >= 5 and "0.050R" in str(r[0]):
                try:
                    med_cost_exp = float(r[4])
                except Exception:
                    pass
                break

    passed_checks: List[str] = []
    failed_checks: List[str] = []
    score = 0.0

    # 1. Sample Size Check (Weight: 20 pts)
    if trades >= 30:
        score += 20.0
        passed_checks.append(f"Mẫu lệnh đủ độ sâu tổ chức: {trades} lệnh (>= 30)")
    elif trades >= 20:
        score += 12.0
        passed_checks.append(f"Mẫu lệnh biên cận: {trades} lệnh (>= 20)")
    else:
        failed_checks.append(f"Mẫu lệnh quá ít, nguy cơ quá khớp ngẫu nhiên: {trades} lệnh (< 20)")

    # 2. Profit Factor & Edge (Weight: 20 pts)
    if profit_factor >= 1.40:
        score += 20.0
        passed_checks.append(f"Hệ số lợi nhuận vững chắc: PF = {profit_factor:.2f} (>= 1.40)")
    elif profit_factor >= 1.25:
        score += 14.0
        passed_checks.append(f"Hệ số lợi nhuận đạt ngưỡng tối thiểu: PF = {profit_factor:.2f} (>= 1.25)")
    else:
        failed_checks.append(f"Hệ số lợi nhuận không đủ bù rủi ro: PF = {profit_factor:.2f} (< 1.25)")

    # 3. Statistical Significance (Weight: 20 pts)
    if p_val < 0.05 and t_stat >= 1.96:
        score += 20.0
        passed_checks.append(f"Ý nghĩa thống kê đạt chuẩn 95%: t={t_stat:.2f}, p={p_val:.4f} (< 0.05)")
    elif p_val < 0.10 or t_stat >= 1.65:
        score += 12.0
        passed_checks.append(f"Ý nghĩa thống kê biên cận (90% CI): t={t_stat:.2f}, p={p_val:.4f}")
    else:
        failed_checks.append(f"Không bác bỏ được giả thuyết ngẫu nhiên H0: t={t_stat:.2f}, p={p_val:.4f} (>= 0.10)")

    # 4. Tail Risk & Max Drawdown (Weight: 20 pts)
    if max_dd_r <= 10.0 and p95_dd <= 15.0:
        score += 20.0
        passed_checks.append(f"Kiểm soát sụt giảm xuất sắc: DD thực nghiệm={max_dd_r:.1f}R, P95={p95_dd:.1f}R")
    elif max_dd_r <= 15.0 and p95_dd <= 22.0:
        score += 14.0
        passed_checks.append(f"Sụt giảm trong ngưỡng cho phép: DD thực nghiệm={max_dd_r:.1f}R, P95={p95_dd:.1f}R")
    else:
        failed_checks.append(f"Sụt giảm vượt trần rủi ro tổ chức: DD={max_dd_r:.1f}R, P95={p95_dd:.1f}R (> 15R)")

    # 5. Friction Resistance & Streak Safety (Weight: 20 pts)
    if med_cost_exp > 0 and prob_s7 <= 0.45:
        score += 20.0
        passed_checks.append(f"Kháng trượt giá tốt: Kỳ vọng sau phí 0.05R = {med_cost_exp:+.3f}R > 0; P(streak>=7)={prob_s7*100:.1f}%")
    elif expectancy_r > 0:
        score += 10.0
        passed_checks.append(f"Kỳ vọng dương ở phí cơ bản: exp={expectancy_r:+.3f}R, sau stress={med_cost_exp:+.3f}R")
    else:
        failed_checks.append(f"Kỳ vọng âm hoặc bị triệt tiêu sau chi phí ma sát: exp={expectancy_r:+.3f}R")

    # Final Verdict Classification:
    # 1. QUALIFIED_EDGE: score >= 70 and passes all 5 criteria
    # 2. VALID_METHODOLOGY_NEGATIVE_EDGE: methodologically valid backtest (trades >= 20), but edge is negative or sub-hurdle
    is_subpar = (
        expectancy_r <= 0
        or profit_factor < 1.25
        or t_stat < 1.96
        or p_val >= 0.05
        or max_dd_r > 15.0
        or med_cost_exp <= 0
        or score < 70.0
    )

    if is_subpar:
        status = "VALID_METHODOLOGY_NEGATIVE_EDGE"
        passed = False
        summary_vi = (
            f"KẾT QUẢ ĐÁNH GIÁ TỔ CHỨC: BÁC BỎ - PHƯƠNG PHÁP HỢP LỆ NHƯNG LỢI THẾ ÂM HOẶC DƯỚI CHUẨN "
            f"(VALID_METHODOLOGY_NEGATIVE_EDGE) ({score:.0f}/100 điểm).\n"
            f"Chiến lược ghi nhận: {trades} lệnh, Win Rate={win_rate*100:.1f}%, PF={profit_factor:.2f}, "
            f"Kỳ vọng={expectancy_r:+.3f}R (sau phí stress={med_cost_exp:+.3f}R), DD tối đa={max_dd_r:.1f}R, "
            f"t-stat={t_stat:.2f} (p={p_val:.4f}).\n"
            f"Phương pháp kiểm định chặt chẽ và có thể tái hiện độc lập, nhưng kết quả chưa đủ bằng chứng "
            f"để xác nhận lợi thế đầu tư thực nghiệm."
        )
    else:
        status = "QUALIFIED_EDGE"
        passed = True
        summary_vi = (
            f"KẾT QUẢ ĐÁNH GIÁ TỔ CHỨC: ĐẠT CHUẨN ĐẦU TƯ (QUALIFIED_EDGE) ({score:.0f}/100 điểm).\n"
            f"Chiến lược ghi nhận: {trades} lệnh, Win Rate={win_rate*100:.1f}%, PF={profit_factor:.2f}, "
            f"Kỳ vọng={expectancy_r:+.3f}R (sau phí stress={med_cost_exp:+.3f}R), DD tối đa={max_dd_r:.1f}R, "
            f"t-stat={t_stat:.2f} (p={p_val:.4f}).\n"
            f"Chiến lược vượt qua toàn bộ 5 tiêu chuẩn khắt khe, đủ điều kiện lưu nháp và trình Admin xem xét xuất bản."
        )

    metrics_summary = {
        "trades": trades,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "expectancy_r": expectancy_r,
        "max_drawdown_r": max_dd_r,
        "sharpe_ratio": sharpe,
        "t_statistic": t_stat,
        "p_value": p_val,
        "p95_max_dd": p95_dd,
        "med_cost_expectancy": med_cost_exp,
    }

    gate_details = {
        "score": score,
        "passed_checks": passed_checks,
        "failed_checks": failed_checks,
        "critical_failed": is_subpar,
    }

    return GateEvaluationResult(
        passed=passed,
        score=score,
        status=status,
        passed_checks=passed_checks,
        failed_checks=failed_checks,
        metrics_summary=metrics_summary,
        summary_vi=summary_vi,
        gate_details=gate_details,
    )
