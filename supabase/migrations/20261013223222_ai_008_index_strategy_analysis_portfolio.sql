-- Cover the portfolio foreign key used by ownership and cleanup checks.
create index strategy_analysis_runs_portfolio_id_idx
  on public.strategy_analysis_runs (portfolio_id);
