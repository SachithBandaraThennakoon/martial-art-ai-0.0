const formatPercent = (value) =>
  Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";

export default function Level1DebugPanel({ state }) {
  const motion = state?.motion_context || {};
  const tracking = state?.tracking || {};
  const forecast = state?.forecast_context || {};

  return (
    <div className="level1-panel">
      <div className="panel-heading">
        <p className="eyebrow">Level 1 Motion</p>
        <span className={state?.ready_for_next_layer ? "is-good" : "is-low"}>
          {state?.ready_for_next_layer ? "Ready" : "Warming"}
        </span>
      </div>

      <div className="level1-grid">
        <div>
          <span>FPS</span>
          <strong>{tracking.fps || "--"}</strong>
        </div>
        <div>
          <span>Tracking</span>
          <strong>{formatPercent(tracking.confidence)}</strong>
        </div>
        <div>
          <span>Filter</span>
          <strong>{motion.filter?.replace(/_/g, " ") || "--"}</strong>
        </div>
        <div>
          <span>Frames</span>
          <strong>{tracking.frame_count || 0}</strong>
        </div>
      </div>

      <div className="level1-metrics">
        <div><span>Smoothing</span><strong>{motion.smoothing_alpha ?? "--"}</strong></div>
        <div><span>Shared forecast</span><strong>{forecast.model_name || "--"}</strong></div>
        <div><span>Forecast status</span><strong>{forecast.status || "--"}</strong></div>
        <div><span>Short horizon</span><strong>{forecast.short_horizon_ms ? `${Math.round(forecast.short_horizon_ms)} ms` : "--"}</strong></div>
      </div>
    </div>
  );
}
