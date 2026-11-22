"""Execution domain — Tabula Rasa Coordinator, Auto-Rollback, Fanout, Watcher, Portfolio & MetaApi."""
from app.domains.execution.regime_strategies import (
    classify_market_regime,
    strat_trend_breakout,
    strat_liquidity_sweep,
    strat_mean_reversion,
    is_market_open_gap_cooldown,
    RegimeMetaRouter,
)
from app.domains.execution.compliance import (
    PROP_RULE_PROFILES,
    get_prop_rule_profile,
    is_friday_weekend_close_window,
    is_daily_profit_locked,
    apply_execution_jitter_and_micro_variance,
    calculate_compliant_sl_tp,
    tag_manual_closed_by_user,
    check_broker_circuit_breaker,
    record_broker_execution_error,
    reset_broker_circuit_breaker,
)

__all__ = [
    "classify_market_regime",
    "strat_trend_breakout",
    "strat_liquidity_sweep",
    "strat_mean_reversion",
    "is_market_open_gap_cooldown",
    "RegimeMetaRouter",
    "PROP_RULE_PROFILES",
    "get_prop_rule_profile",
    "is_friday_weekend_close_window",
    "is_daily_profit_locked",
    "apply_execution_jitter_and_micro_variance",
    "calculate_compliant_sl_tp",
    "tag_manual_closed_by_user",
    "check_broker_circuit_breaker",
    "record_broker_execution_error",
    "reset_broker_circuit_breaker",
]


