export default function DiagnosticTraceControls({
  active,
  description = "Captures a 5 Hz timeline plus the full available pipeline every second: perception, comparisons, rule engine, L1–L4, reasoning, actions, feedback, and voice state. No camera video is stored.",
  recordCount,
  onClear,
  onDownload,
  onStart,
  onStop
}) {
  return (
    <div className="panel-block diagnostic-trace-controls">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Development trace</p>
          <strong>{active ? "Recording diagnostic data" : "Diagnostic recorder"}</strong>
        </div>
        <span>{recordCount} records</span>
      </div>
      <p className="diagnostic-trace-controls__copy">
        {description}
      </p>
      <div className="diagnostic-trace-controls__actions">
        {active ? (
          <button type="button" onClick={onStop}>Stop trace</button>
        ) : (
          <button type="button" onClick={onStart}>Start trace</button>
        )}
        <button disabled={!recordCount || active} type="button" onClick={onDownload}>
          Download trace
        </button>
        <button disabled={!recordCount || active} type="button" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}
