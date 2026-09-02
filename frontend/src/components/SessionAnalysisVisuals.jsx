const formatTime = (milliseconds = 0) => {
  const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
};

const formatLabel = (value) =>
  value
    ? String(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Preparation";

export function SessionAnalysisMap({
  analysis,
  completedReps = null,
  onSelectFrame,
  selectedFrame
}) {
  if (!analysis?.segments?.length) return null;
  const duration = Math.max(analysis.duration_ms, 1);
  const reconciledReps = Number.isFinite(completedReps)
    ? completedReps
    : analysis.clustered_completed_repetitions;

  return (
    <section className="stored-tape-panel__map">
      <div>
        <p className="eyebrow">Session map</p>
        <strong>Movement timeline</strong>
        <span>{reconciledReps}/{analysis.target_repetitions} completed</span>
      </div>
      <div className="stored-tape-panel__segments">
        {analysis.segments.map((segment, index) => (
          <button
            className={`is-${segment.kind} ${
              segment.has_review ? "has-review" : ""
            } ${
              selectedFrame >= segment.start_frame_index &&
              selectedFrame <= segment.end_frame_index
                ? "is-selected"
                : ""
            }`}
            key={`${segment.key}-${index}`}
            onClick={() => onSelectFrame?.(segment.start_frame_index)}
            style={{ flexGrow: Math.max(1, segment.duration_ms / duration * 100) }}
            title={`${segment.phase_label} · ${Math.round(segment.duration_ms)}ms`}
            type="button"
          >
            <strong>
              {segment.kind === "preparation"
                ? "PREP"
                : segment.rep
                  ? `R${segment.rep} S${segment.step}`
                  : "MOVE"}
            </strong>
            <small>{segment.phase_label}</small>
          </button>
        ))}
      </div>
      <div className="stored-tape-panel__reps">
        {analysis.repetitions.map((repetition) => (
          <button
            className={`is-${repetition.status}`}
            key={repetition.rep}
            onClick={() => onSelectFrame?.(repetition.start_frame_index)}
            type="button"
          >
            <span>Rep {repetition.rep}</span>
            <strong>{formatLabel(repetition.status)}</strong>
            <small>{repetition.step_coverage_percentage}% steps</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export function SessionAccuracyChart({
  frames = [],
  onSelectFrame,
  selectedFrame
}) {
  const scored = frames.filter(
    (frame) => frame.scorable !== false && Number.isFinite(frame.accuracy)
  );
  if (!scored.length) {
    return <div className="stored-tape-panel__accuracy-empty">No scored frames in this tape.</div>;
  }
  const duration = Math.max(frames.at(-1)?.elapsedMs || 0, 1);
  const points = scored.map((frame) => ({
    x: (frame.elapsedMs / duration) * 1000,
    y: 110 - (Math.max(0, Math.min(100, frame.accuracy)) / 100) * 90,
    frame
  }));
  const path = points
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  const pointStride = Math.max(1, Math.floor(points.length / 40));

  return (
    <div className="stored-tape-panel__accuracy">
      <div><span>Session accuracy</span><small>Click a point to inspect the frame</small></div>
      <svg aria-label="Session accuracy timeline" role="img" viewBox="0 0 1000 125">
        <line x1="0" x2="1000" y1="38" y2="38" />
        <path d={path} />
        {points
          .filter((_, index) => index % pointStride === 0)
          .map((point) => (
            <circle
              className={point.frame.frame - 1 === selectedFrame ? "is-selected" : ""}
              cx={point.x}
              cy={point.y}
              key={point.frame.frame}
              onClick={() => onSelectFrame?.(point.frame.frame - 1)}
              r={point.frame.frame - 1 === selectedFrame ? 6 : 3}
            >
              <title>{`${formatTime(point.frame.elapsedMs)} · ${point.frame.accuracy}%`}</title>
            </circle>
          ))}
      </svg>
    </div>
  );
}

export function SessionMomentFacts({
  accuracy,
  accuracyLabel = "Accuracy estimate",
  phase,
  rep,
  step,
  timestamp,
  tracking
}) {
  return (
    <>
      <span><small>Timestamp</small><strong>{timestamp}</strong></span>
      <span><small>Rep</small><strong>{rep}</strong></span>
      <span><small>Step</small><strong>{step}</strong></span>
      <span><small>Phase</small><strong>{phase}</strong></span>
      <span><small>{accuracyLabel}</small><strong>{accuracy}</strong></span>
      <span><small>Tracking</small><strong>{tracking}</strong></span>
    </>
  );
}

export function SessionScoreReason({ className = "", explanation }) {
  if (!explanation) return null;
  return (
    <section className={`${className} is-${explanation.tone}`.trim()}>
      <small>{explanation.title}</small>
      <strong>{explanation.summary}</strong>
      {explanation.details.length ? (
        <ul>
          {explanation.details.map((detail) => <li key={detail}>{detail}</li>)}
        </ul>
      ) : null}
    </section>
  );
}
