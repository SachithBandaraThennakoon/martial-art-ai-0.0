import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../services/api";
import { authFetch, getAccessToken } from "../services/authSession";
import { techniqueCatalog } from "../data/techniqueCatalog";
import { buildPracticeSessionAnalysis } from "../utils/practiceSessionAnalysis";
import { buildPracticeScoreExplanation } from "../utils/practiceScoreExplanation";
import {
  SessionAccuracyChart,
  SessionAnalysisMap,
  SessionMomentFacts,
  SessionScoreReason
} from "./SessionAnalysisVisuals";

const CONNECTIONS = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]
];
const VISIBLE_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const restoreCoordinate = (value) =>
  Number.isFinite(value) ? value / 10000 : null;

const decodePose = (landmarks = []) =>
  landmarks.map(([x, y, z, visibility]) => ({
    x: restoreCoordinate(x),
    y: restoreCoordinate(y),
    z: restoreCoordinate(z),
    visibility: Number.isFinite(visibility) ? restoreCoordinate(visibility) : 1
  }));

const decodeFrame = (frame, index) => ({
  elapsedMs: frame.t || 0,
  frame: frame.n || index + 1,
  rep: frame.r || 1,
  step: frame.s || 1,
  accuracy: frame.a ?? null,
  focusBodyPart: frame.f || null,
  issue: frame.i || null,
  wrongBodyParts: frame.w || [],
  advisoryBodyParts: frame.aw || [],
  angles: Object.fromEntries(
    Object.entries(frame.av || {}).map(([name, value]) => [
      name,
      Number.isFinite(value) ? value / 100 : null
    ])
  ),
  landmarks: decodePose(frame.p),
  trackingConfidence: Number.isFinite(frame.tc) ? frame.tc / 1000 : null,
  phase: frame.ph || "keyframe",
  temporalPhase: frame.tp || "between_steps",
  stateConfidence: frame.cf ?? null,
  trackingReliable: frame.tr !== false,
  liveRep: frame.lr ?? null,
  liveStep: frame.ls ?? null,
  matchedStep: frame.ms ?? null,
  countedRep: frame.nr ?? null,
  completedRep: frame.dr ?? null,
  postSessionClassified: frame.ps === true,
  scorable: frame.sc !== false
});

function StoredTapeSkeleton({ landmarks = [], mirrored = true }) {
  const pointAt = (index) => {
    const point = landmarks[index];
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    return {
      x: (mirrored ? 1 - point.x : point.x) * 100,
      y: point.y * 100
    };
  };
  return (
    <svg aria-hidden="true" className="practice-tape-skeleton" viewBox="0 0 100 100">
      {CONNECTIONS.map(([from, to]) => {
        const start = pointAt(from);
        const end = pointAt(to);
        return start && end ? (
          <line key={`${from}-${to}`} x1={start.x} x2={end.x} y1={start.y} y2={end.y} />
        ) : null;
      })}
      {VISIBLE_JOINTS.map((index) => {
        const point = pointAt(index);
        return point ? <circle cx={point.x} cy={point.y} key={index} r={index === 0 ? 3 : 1.8} /> : null;
      })}
      {!landmarks.length ? <text x="50" y="52" textAnchor="middle">POSE</text> : null}
    </svg>
  );
}

const practiceSessionId = (session) => {
  if (session?.mode && session.mode !== "practice") return null;
  const value = String(session?.id ?? "");
  const match = value.match(/^(?:practice-)?(\d+)$/);
  return match ? Number(match[1]) : null;
};

const formatTime = (milliseconds = 0) => {
  const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
};

const formatLabel = (value) =>
  value
    ? String(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Preparation";

export default function StoredSessionTapePanel({
  defaultExpanded = false,
  session
}) {
  const sessionId = practiceSessionId(session);
  const tapeKnownMissing = session?.tape_available === false;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loadState, setLoadState] = useState(tapeKnownMissing ? "missing" : "idle");
  const [message, setMessage] = useState(
    tapeKnownMissing ? "No frame tape was stored for this session." : ""
  );
  const [tape, setTape] = useState(null);
  const [selectedFrame, setSelectedFrame] = useState(0);

  const loadTape = useCallback(async () => {
    if (!sessionId || loadState === "loading") return;
    const token = getAccessToken();
    if (!token) {
      setLoadState("error");
      setMessage("Log in to load this stored tape.");
      return;
    }
    setLoadState("loading");
    setMessage("Loading the stored 30 FPS movement tape.");
    try {
      const response = await authFetch(
        `${API_BASE_URL}/practice/sessions/${sessionId}/tape`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) throw new Error(response.status === 404 ? "missing" : "request");
      const data = await response.json();
      const frames = (data.frames || []).map(decodeFrame);
      setTape({ ...data, frames });
      setLoadState("ready");
      setMessage("");
    } catch (error) {
      setLoadState(error.message === "missing" ? "missing" : "error");
      setMessage(
        error.message === "missing"
          ? "No frame tape was stored for this session."
          : "The stored tape could not be loaded."
      );
    }
  }, [loadState, sessionId]);

  useEffect(() => {
    if (expanded && sessionId && loadState === "idle") loadTape();
  }, [expanded, loadState, loadTape, sessionId]);

  const frames = useMemo(() => tape?.frames || [], [tape]);
  const steps = useMemo(() => {
    const storedSteps = tape?.metadata?.steps || [];
    const techniqueName = tape?.metadata?.techniqueName || session?.technique_name;
    const catalogTechnique = techniqueCatalog
      .flatMap((category) => category.subcategories)
      .flatMap((subcategory) => subcategory.techniques)
      .find((technique) => technique.name === techniqueName);
    const catalogSteps = catalogTechnique?.steps || [];
    if (!storedSteps.length) return catalogSteps;
    return storedSteps.map((storedStep, index) => ({
      ...(catalogSteps[index] || {}),
      ...storedStep,
      angles: storedStep.angles?.length
        ? storedStep.angles
        : catalogSteps[index]?.angles || []
    }));
  }, [session?.technique_name, tape]);
  const analysis = useMemo(
    () =>
      frames.length
        ? buildPracticeSessionAnalysis(frames, {
            steps,
            targetReps: session?.target_reps,
            strictSummary: tape?.metadata?.ruleEngineAnalysis?.summary || null
          })
        : null,
    [frames, session?.target_reps, steps, tape?.metadata?.ruleEngineAnalysis?.summary]
  );
  const currentFrame = frames[selectedFrame] || null;
  const assignment = analysis?.frame_assignments?.[selectedFrame] || null;
  const selectedStep = assignment?.step
    ? steps[Math.max(0, assignment.step - 1)] || null
    : null;
  const scoreExplanation = buildPracticeScoreExplanation(currentFrame, {
    step: selectedStep
  });
  const scoredFrames = frames.filter(
    (frame) => frame.scorable !== false && Number.isFinite(frame.accuracy)
  );
  const averageAccuracy = scoredFrames.length
    ? Math.round(
        scoredFrames.reduce((sum, frame) => sum + frame.accuracy, 0) /
          scoredFrames.length
      )
    : null;

  if (!sessionId) return null;

  return (
    <section className={`stored-tape-panel ${expanded ? "is-expanded" : "is-collapsed"}`}>
      <header className="stored-tape-panel__header">
        <div>
          <p className="eyebrow">Full session analysis</p>
          <strong>
            {session?.completed_reps ?? session?.reps ?? 0}/
            {session?.target_reps ?? 0} reps
            {frames.length ? ` · ${frames.length} frames · ${formatTime(tape?.duration_ms)}` : ""}
          </strong>
          <small>Device-generated coaching estimate — not an independently validated performance score.</small>
        </div>
        <button
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "Collapse" : "Expand full tape"}
        </button>
      </header>

      {expanded ? (
        <div className="stored-tape-panel__body">
          {loadState === "loading" ? <p className="stored-tape-panel__state">{message}</p> : null}
          {loadState === "missing" ? (
            <p className="stored-tape-panel__state">{message}</p>
          ) : null}
          {loadState === "error" ? (
            <div className="stored-tape-panel__state is-error">
              <p>{message}</p>
              <button onClick={loadTape} type="button">Try again</button>
            </div>
          ) : null}
          {loadState === "ready" && analysis && currentFrame ? (
            <>
              <SessionAnalysisMap
                analysis={analysis}
                onSelectFrame={setSelectedFrame}
                selectedFrame={selectedFrame}
              />
              <SessionAccuracyChart
                frames={frames}
                onSelectFrame={setSelectedFrame}
                selectedFrame={selectedFrame}
              />
              <input
                aria-label="Selected tape frame"
                max={Math.max(0, frames.length - 1)}
                min="0"
                onChange={(event) => setSelectedFrame(Number(event.target.value))}
                type="range"
                value={selectedFrame}
              />
              <div className="stored-tape-panel__inspection">
                <div className="stored-tape-panel__details">
                  <p className="eyebrow">Movement details</p>
                  <h3>Selected moment</h3>
                  <div>
                    <SessionMomentFacts
                      accuracy={Number.isFinite(currentFrame.accuracy) ? `${currentFrame.accuracy}%` : "Not scored"}
                      phase={formatLabel(assignment?.phase)}
                      rep={assignment?.rep || "Preparation"}
                      step={assignment?.step
                        ? selectedStep?.step_name || `Step ${assignment.step}`
                        : "Preparation"}
                      timestamp={formatTime(currentFrame.elapsedMs)}
                      tracking={currentFrame.trackingReliable === false ? "Lost" : "Tracked"}
                    />
                  </div>
                  <SessionScoreReason
                    className="stored-tape-panel__score-reason"
                    explanation={scoreExplanation}
                  />
                  <div className="stored-tape-panel__summary">
                    <span><small>Average</small><strong>{averageAccuracy == null ? "--" : `${averageAccuracy}%`}</strong></span>
                    <span><small>Review frames</small><strong>{scoredFrames.filter((frame) => frame.accuracy < 80).length}</strong></span>
                    <span><small>Reps</small><strong>{analysis.clustered_completed_repetitions}/{analysis.target_repetitions}</strong></span>
                    <span><small>Tracking</small><strong>{analysis.tracking_quality_percentage}%</strong></span>
                  </div>
                </div>
                <div className="stored-tape-panel__skeleton">
                  <div><span>Selected frame</span><strong>Frame {selectedFrame + 1}</strong></div>
                  <StoredTapeSkeleton
                    landmarks={currentFrame.landmarks}
                    mirrored
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
