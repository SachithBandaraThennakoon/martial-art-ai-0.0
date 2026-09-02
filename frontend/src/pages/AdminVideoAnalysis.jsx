import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import SessionAnalysisPanel from "../components/SessionAnalysisPanel";
import {
  SessionAnalysisMap,
  SessionMomentFacts
} from "../components/SessionAnalysisVisuals";
import SkeletonCanvas from "../components/SkeletonCanvas";
import {
  getTechniqueTrackingPackage,
  techniqueCatalog
} from "../data/techniqueCatalog";
import { TrackingSessionEngine } from "../tracking/trackingSessionEngine";

const formatPercent = (value) => {
  if (!Number.isFinite(value)) return "--";
  const numericValue = Number(value);
  const percentage = Math.abs(numericValue) <= 1 ? numericValue * 100 : numericValue;
  return `${percentage.toFixed(1)}%`;
};

const percentValue = (value) => {
  if (!Number.isFinite(value)) return null;
  const numericValue = Number(value);
  return Number((Math.abs(numericValue) <= 1 ? numericValue * 100 : numericValue).toFixed(1));
};

const formatLabel = (value) => String(value || "Unavailable")
  .replace(/^__|__$/g, "")
  .replace(/_/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatTime = (milliseconds = 0) => {
  const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
};

const formatOptionalTime = (milliseconds) =>
  Number.isFinite(milliseconds) ? formatTime(milliseconds) : "--";

function toSessionRecord(result, techniqueName, expectedReps) {
  if (!result) return null;
  const summary = result.summary;
  const repetitions = summary.repetitions || [];
  const completed = repetitions.filter((repetition) => repetition.status === "completed");
  const cleanReps = completed.filter((repetition) => !(repetition.form_errors || []).length).length;
  const confidenceValues = completed.map((repetition) => percentValue(repetition.confidence)).filter(Number.isFinite);
  const averageConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;
  const consistency = confidenceValues.length
    ? Math.max(0, 100 - Math.sqrt(
        confidenceValues.reduce((sum, value) => sum + (value - averageConfidence) ** 2, 0)
        / confidenceValues.length
      ))
    : 0;

  return {
    id: `uploaded-${result.engine}-${result.completedAt}`,
    technique_name: techniqueName,
    mode: "practice",
    status: summary.detected_attempts === expectedReps ? "completed" : "incomplete",
    started_at: result.startedAt,
    ended_at: result.completedAt,
    completed_reps: summary.detected_attempts,
    target_reps: expectedReps,
    clean_reps: cleanReps,
    average_accuracy: percentValue(summary.technique_quality),
    consistency_score: Number.isFinite(summary.consistency)
      ? percentValue(summary.consistency)
      : Number(consistency.toFixed(1)),
    analytics: {
      ...summary,
      average_accuracy: percentValue(summary.technique_quality)
    }
  };
}

function buildTimeline(result, expectedReps) {
  const sourceFrames = result?.summary.corrected_timeline?.frames
    || result?.summary.raw_timeline?.frames
    || [];
  if (!sourceFrames.length) return null;
  const firstTimestamp = Number(sourceFrames[0]?.timestamp_ms) || 0;
  const stepNumbers = new Map();
  const frames = sourceFrames.map((frame, index) => {
    if (frame.step && !stepNumbers.has(frame.step)) {
      stepNumbers.set(frame.step, stepNumbers.size + 1);
    }
    return {
      ...frame,
      elapsedMs: Math.max(0, (Number(frame.timestamp_ms) || firstTimestamp) - firstTimestamp),
      frame: index + 1,
      accuracy: percentValue(frame.confidence),
      scorable: !frame.tracking_lost && !frame.unknown_movement,
      rep: frame.rep_id,
      stepNumber: stepNumbers.get(frame.step) || 0
    };
  });

  const segments = [];
  frames.forEach((frame, index) => {
    const kind = frame.rep_id ? "movement" : "preparation";
    const key = `${kind}:${frame.rep_id || 0}:${frame.step || "none"}:${frame.canonical_phase || frame.phase || "unknown"}`;
    const previous = segments.at(-1);
    if (previous?.key === key) {
      previous.end_frame_index = index;
      previous.duration_ms = Math.max(1, frame.elapsedMs - previous.start_ms);
      previous.has_review ||= frame.tracking_lost || frame.unknown_movement || Boolean(frame.form_errors?.length);
      return;
    }
    segments.push({
      key,
      kind,
      rep: frame.rep_id,
      step: frame.stepNumber,
      phase_label: formatLabel(frame.canonical_phase || frame.phase),
      start_ms: frame.elapsedMs,
      duration_ms: 1,
      start_frame_index: index,
      end_frame_index: index,
      has_review: frame.tracking_lost || frame.unknown_movement || Boolean(frame.form_errors?.length)
    });
  });

  const repetitions = (result.summary.repetitions || []).map((repetition, index) => ({
    rep: repetition.rep_id || index + 1,
    status: repetition.status === "completed" ? "completed" : "incomplete",
    start_frame_index: Math.max(0, frames.findIndex((frame) => frame.timestamp_ms >= repetition.start_ms)),
    step_coverage_percentage: repetition.status === "completed" ? 100 : 0
  }));

  return {
    frames,
    analysis: {
      duration_ms: frames.at(-1)?.elapsedMs || 1,
      target_repetitions: expectedReps,
      clustered_completed_repetitions: result.summary.completed_repetitions,
      segments,
      repetitions
    }
  };
}

function EngineTimelinePanel({ expectedReps, result }) {
  const [selectedFrame, setSelectedFrame] = useState(0);
  const timeline = useMemo(() => buildTimeline(result, expectedReps), [expectedReps, result]);
  const frame = timeline?.frames[selectedFrame] || null;
  const stateScores = Object.entries(frame?.state_scores || {})
    .sort(([, first], [, second]) => second - first)
    .slice(0, 5);

  if (!timeline) return null;

  return (
    <section className="admin-video-analysis__timeline stored-tape-panel">
      <header className="stored-tape-panel__header">
        <div>
          <p className="eyebrow">Rule timeline</p>
          <strong>{timeline.frames.length} classified frames · {formatTime(timeline.analysis.duration_ms)}</strong>
        </div>
      </header>
      <div className="stored-tape-panel__body">
        <SessionAnalysisMap
          analysis={timeline.analysis}
          completedReps={result.summary.completed_repetitions}
          onSelectFrame={setSelectedFrame}
          selectedFrame={selectedFrame}
        />
        <input
          aria-label={`Selected ${result.engine} analysis frame`}
          max={Math.max(0, timeline.frames.length - 1)}
          min="0"
          onChange={(event) => setSelectedFrame(Number(event.target.value))}
          type="range"
          value={selectedFrame}
        />
        <div className="admin-video-analysis__frame-inspection">
          <div>
            <h2>Selected frame</h2>
            <div className="practice-session-analysis__frame-meta">
              <SessionMomentFacts
                accuracy={formatPercent(frame.confidence)}
                accuracyLabel="Detection confidence"
                phase={formatLabel(frame.canonical_phase || frame.phase)}
                rep={frame.rep_id || "Preparation"}
                step={formatLabel(frame.step)}
                timestamp={formatTime(frame.elapsedMs)}
                tracking={frame.tracking_lost ? "Lost" : "Tracked"}
              />
            </div>
          </div>
          <div>
            <h2>Top state scores</h2>
            <ul>
              {stateScores.map(([state, score]) => (
                <li key={state}><span>{formatLabel(state)}</span><strong>{formatPercent(score)}</strong></li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function resultStatus(result, expectedReps) {
  if (!result) return "Not run";
  const detectedReps = result.summary.detected_attempts;
  if (detectedReps === expectedReps) return "Expected count matched";
  if (detectedReps === 0) return "No repetitions detected";
  return `Detected ${detectedReps} of ${expectedReps}`;
}

function AnalysisResultCard({ expectedReps, result, title }) {
  if (!result) return null;
  const summary = result.summary;
  const errors = summary.common_form_errors || [];

  return (
    <article className="admin-video-analysis__result">
      <header>
        <div>
          <span>{title}</span>
          <strong>{resultStatus(result, expectedReps)}</strong>
        </div>
        <small>{result.frameCount} analyzed frames</small>
      </header>

      <div className="admin-video-analysis__metrics">
        <div><span>Detected attempts</span><strong>{summary.detected_attempts}/{expectedReps}</strong></div>
        <div><span>Completed motions</span><strong>{summary.completed_motions}</strong></div>
        <div><span>Technique quality</span><strong>{formatPercent(summary.technique_quality)}</strong></div>
        <div><span>Detection confidence</span><strong>{formatPercent(summary.detection_confidence)}</strong></div>
        <div><span>Tracking quality</span><strong>{formatPercent(summary.tracking_quality)}</strong></div>
        <div><span>Consistency</span><strong>{formatPercent(summary.consistency)}</strong></div>
        <div><span>Corrections</span><strong>{summary.corrections_applied || 0}</strong></div>
      </div>

      <section>
        <h2>Confirmed form errors</h2>
        {errors.length ? (
          <ul>
            {errors.slice(0, 8).map((error) => (
              <li key={error.error_id}>
                <span>{String(error.error_id).replace(/_/g, " ")}</span>
                <strong>{error.count}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p>No confirmed form errors.</p>
        )}
      </section>

      <section>
        <h2>Movement attempts</h2>
        {summary.repetitions?.length ? (
          <ul>
            {summary.repetitions.map((repetition) => (
              <li key={repetition.rep_id}>
                <span>
                  Rep {repetition.rep_id} · {formatOptionalTime(repetition.start_ms)} → {formatOptionalTime(repetition.peak_ms)} → {formatOptionalTime(repetition.end_ms)}
                  {(repetition.form_errors || []).length
                    ? ` · ${(repetition.form_errors || []).join(", ").replace(/_/g, " ")}`
                    : " · no confirmed error"}
                </span>
                <strong>
                  {Math.round(repetition.duration_ms || 0)}ms · {formatPercent(repetition.technique_quality)}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <p>No meaningful movement attempt was detected.</p>
        )}
      </section>

    </article>
  );
}

export default function AdminVideoAnalysis() {
  const [techniqueKey, setTechniqueKey] = useState("");
  const [expectedReps, setExpectedReps] = useState(5);
  const [videoFile, setVideoFile] = useState(null);
  const [inputStatus, setInputStatus] = useState("Choose a video to begin.");
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [lastFrame, setLastFrame] = useState(null);
  const [liveCount, setLiveCount] = useState(0);
  const [playerVersion, setPlayerVersion] = useState(0);
  const [isSessionPopupOpen, setIsSessionPopupOpen] = useState(false);
  const videoControllerRef = useRef(null);
  const enginesRef = useRef({});
  const lastFrameRef = useRef(null);
  const runRef = useRef({
    active: false,
    frameCount: 0,
    startedAt: null
  });

  const techniques = useMemo(
    () => techniqueCatalog.flatMap((category) =>
      category.subcategories.flatMap((subcategory) =>
        subcategory.techniques.flatMap((technique) => {
          const trackingPackage = getTechniqueTrackingPackage(technique);
          return trackingPackage
            ? [{ category: category.category, subcategory: subcategory.name, technique, trackingPackage }]
            : [];
        })
      )
    ),
    []
  );

  const selectedTechnique = useMemo(
    () => techniques.find((entry) => String(entry.technique.id) === techniqueKey)
      || techniques.find((entry) => entry.technique.name.toLowerCase() === "jab")
      || techniques[0]
      || null,
    [techniqueKey, techniques]
  );

  const steps = useMemo(
    () => selectedTechnique?.technique.steps || [],
    [selectedTechnique]
  );
  const selectedStep = steps[0] || null;
  const measurementParts = useMemo(() => {
    const parts = new Map();
    steps.flatMap((step) => step?.evaluation_profile?.full_body_angles || step?.angles || [])
      .forEach((part) => {
        if (part?.body_part && !parts.has(part.body_part)) parts.set(part.body_part, part);
      });
    return [...parts.values()];
  }, [steps]);

  const finalizeRun = useCallback((completionStatus = "Finished") => {
    if (!runRef.current.active) return;
    runRef.current.active = false;
    const endedAt = Number(lastFrameRef.current?.timestamp_ms) || performance.now();
    const completedAt = new Date().toISOString();
    const nextResults = {};

    Object.entries(enginesRef.current).forEach(([engineName, engine]) => {
      nextResults[engineName] = {
        engine: engineName,
        frameCount: runRef.current.frameCount,
        startedAt: runRef.current.startedAt,
        completedAt,
        summary: engine.end(endedAt)
      };
    });

    enginesRef.current = {};
    setResults(nextResults);
    setIsRunning(false);
    setInputStatus(completionStatus);
    setIsSessionPopupOpen(true);
  }, []);

  const handleInputStatus = useCallback((status) => {
    setInputStatus(status);
    if (String(status).startsWith("Video finished:")) {
      finalizeRun(status);
    } else if (String(status).includes("could not play")) {
      runRef.current.active = false;
      enginesRef.current = {};
      setIsRunning(false);
    }
  }, [finalizeRun]);

  const handleAnalysisFrame = useCallback((frame) => {
    if (!frame || !runRef.current.active || !Number.isFinite(frame.timestamp_ms)) return;
    lastFrameRef.current = frame;
    setLastFrame(frame);
    runRef.current.frameCount += 1;
    const commonInput = {
      timestampMs: frame.timestamp_ms,
      features: frame.features || {},
      trackingConfidence: frame.tracking_confidence,
      evaluationContext: {},
      learnedStatePrediction: null,
      learnedModelExpected: false,
      frameIndex: frame.frame_index,
      videoTimestampMs: frame.video_timestamp_ms,
      processingTimestampMs: frame.processing_timestamp_ms,
      deltaVideoMs: frame.delta_video_ms
    };
    enginesRef.current.rules?.updateFeatures(commonInput);
    setLiveCount(
      (enginesRef.current.rules?.repetitions.length || 0)
      + (enginesRef.current.rules?.currentRepetition ? 1 : 0)
    );
  }, []);

  const selectVideo = useCallback((event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setInputStatus("Unsupported file. Choose a video file.");
      return;
    }

    setVideoFile((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return {
        name: file.name,
        size: file.size,
        type: file.type,
        url: URL.createObjectURL(file)
      };
    });
    enginesRef.current = {};
    runRef.current.active = false;
    setResults(null);
    setIsSessionPopupOpen(false);
    setLiveCount(0);
    lastFrameRef.current = null;
    setLastFrame(null);
    setIsRunning(false);
    setInputStatus(`Loading video: ${file.name}`);
    setPlayerVersion((version) => version + 1);
  }, []);

  useEffect(() => () => {
    if (videoFile?.url) URL.revokeObjectURL(videoFile.url);
  }, [videoFile?.url]);

  const runAnalysis = useCallback(async () => {
    if (!videoFile || !selectedTechnique?.trackingPackage || isRunning) return;
    const nextEngines = {};
    const startedAt = 0;
    nextEngines.rules = new TrackingSessionEngine(selectedTechnique.trackingPackage, {
      mode: "practice",
      analysisEngine: "rules"
    });
    nextEngines.rules.start(startedAt);

    enginesRef.current = nextEngines;
    runRef.current = {
      active: true,
      frameCount: 0,
      startedAt: new Date().toISOString()
    };
    setResults(null);
    setLiveCount(0);
    lastFrameRef.current = null;
    setLastFrame(null);
    setIsRunning(true);
    setInputStatus("Starting deterministic rule-based analysis…");

    try {
      const started = await videoControllerRef.current?.restartUploaded?.();
      if (!started) throw new Error("The video is not ready yet.");
    } catch (error) {
      runRef.current.active = false;
      enginesRef.current = {};
      setIsRunning(false);
      setInputStatus(error.message || "Unable to start video analysis.");
    }
  }, [isRunning, selectedTechnique, videoFile]);

  const stopAnalysis = useCallback(() => {
    finalizeRun("Analysis stopped before the video ended.");
    setPlayerVersion((version) => version + 1);
  }, [finalizeRun]);

  const downloadResults = useCallback(() => {
    if (!results || !videoFile) return;
    const blob = new Blob([JSON.stringify({
      video: { name: videoFile.name, size: videoFile.size, type: videoFile.type },
      technique: selectedTechnique?.technique.name,
      expectedReps,
      requestedEngine: "rules",
      generatedAt: new Date().toISOString(),
      results
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${videoFile.name.replace(/\.[^.]+$/, "")}-analysis.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [expectedReps, results, selectedTechnique, videoFile]);

  const canRun = Boolean(
    videoFile
    && selectedTechnique
    && !isRunning
    && (inputStatus.startsWith("Video ready:") || inputStatus.startsWith("Video finished:") || inputStatus.includes("stopped"))
  );
  const resultList = [results?.rules].filter(Boolean);
  const activePopupResult = results?.rules || null;
  const activePopupSession = toSessionRecord(
    activePopupResult,
    selectedTechnique?.technique.name,
    expectedReps
  );

  return (
    <main className="admin-video-analysis">
      <header className="admin-video-analysis__header">
        <div>
          <p className="eyebrow">Admin analysis</p>
          <h1>Video session analyzer</h1>
          <p>Upload a session for deterministic movement detection, phase segmentation, and biomechanical scoring.</p>
        </div>
        <Link className="btn btn--ghost" to="/admin-studio">Back to Admin Studio</Link>
      </header>

      <section className="admin-video-analysis__controls" aria-label="Video analysis controls">
        <label>
          <span>Technique</span>
          <select
            aria-label="Analysis technique"
            disabled={isRunning}
            onChange={(event) => setTechniqueKey(event.target.value)}
            value={String(selectedTechnique?.technique.id || "")}
          >
            {techniques.map((entry) => (
              <option key={entry.technique.id} value={entry.technique.id}>
                {entry.technique.name} · {entry.subcategory}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Expected repetitions</span>
          <input
            aria-label="Expected repetitions"
            disabled={isRunning}
            max="100"
            min="1"
            onChange={(event) => setExpectedReps(Math.max(1, Number(event.target.value) || 1))}
            type="number"
            value={expectedReps}
          />
        </label>

        <label className="admin-video-analysis__file">
          <span>Session video</span>
          <input
            accept="video/mp4,video/webm,video/quicktime,video/*"
            aria-label="Upload session video"
            disabled={isRunning}
            onChange={selectVideo}
            type="file"
          />
          {videoFile ? <small>{videoFile.name} · {(videoFile.size / 1024 / 1024).toFixed(1)} MB</small> : null}
        </label>

        <div className="admin-video-analysis__actions">
          <button className="btn btn--light" disabled={!canRun} onClick={runAnalysis} type="button">
            Run analysis
          </button>
          <button className="btn btn--ghost" disabled={!isRunning} onClick={stopAnalysis} type="button">
            Stop
          </button>
          <button className="btn btn--ghost" disabled={!results} onClick={downloadResults} type="button">
            Download JSON
          </button>
          <button
            className="btn btn--ghost"
            disabled={!results}
            onClick={() => setIsSessionPopupOpen(true)}
            type="button"
          >
            Open session popup
          </button>
        </div>
      </section>

      <section className="admin-video-analysis__workspace">
        <div className="admin-video-analysis__preview">
          {videoFile && selectedTechnique ? (
            <SkeletonCanvas
              key={`${videoFile.url}:${playerVersion}`}
              capturePoseOnly={false}
              currentStepId={selectedStep?.id}
              currentStepName={selectedStep?.step_name}
              displayMirrored={false}
              enableAwareness={false}
              enableCoach={false}
              expectedParts={measurementParts}
              feedbackParts={measurementParts}
              inputSource="video"
              inputVideoName={videoFile.name}
              inputVideoUrl={videoFile.url}
              measurementParts={measurementParts}
              onInputStatus={handleInputStatus}
              onPracticeVideoController={(controller) => {
                videoControllerRef.current = controller;
              }}
              onRuleEngineFrameUpdate={handleAnalysisFrame}
              performanceMode="quality"
              performanceProfile="admin"
              requiredParts={selectedStep?.angles || []}
              sessionConfig={{ technique_name: selectedTechnique.technique.name, mode: "practice" }}
              skeletonLayers={{ corrections: true, expected: false, level1: true }}
              temporalInferenceMode="rules"
              trackingSessionActive={isRunning}
            />
          ) : (
            <p>Choose a supported video file.</p>
          )}
        </div>

        <aside className="admin-video-analysis__status" aria-live="polite">
          <div><span>Status</span><strong>{inputStatus}</strong></div>
          <div><span>Engine</span><strong>Deterministic rules</strong></div>
          <div><span>Frames</span><strong>{runRef.current.frameCount}</strong></div>
          <div><span>Current phase</span><strong>{lastFrame?.canonical_phase || "--"}</strong></div>
          <div>
            <span>Detected reps</span>
            <strong>
              {`${liveCount}/${expectedReps}`}
            </strong>
          </div>
        </aside>
      </section>

      {results ? (
        <section className="admin-video-analysis__completed-analysis">
          <div className="admin-video-analysis__results">
            <AnalysisResultCard expectedReps={expectedReps} result={results.rules} title="Production analysis" />
          </div>

          <div className="admin-video-analysis__session-panels">
            {resultList.map((result) => (
              <div className="admin-video-analysis__session-group" key={`session-${result.engine}`}>
                <SessionAnalysisPanel
                  eyebrow="Rule-based session analysis"
                  session={toSessionRecord(result, selectedTechnique?.technique.name, expectedReps)}
                />
                <EngineTimelinePanel expectedReps={expectedReps} result={result} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {isSessionPopupOpen && activePopupResult ? (
        <section
          aria-label="Uploaded video session analysis"
          aria-modal="true"
          className="admin-video-analysis__popup"
          role="dialog"
        >
          <header>
            <div>
              <p className="eyebrow">Full session analysis</p>
              <strong>{selectedTechnique?.technique.name} · {videoFile?.name}</strong>
            </div>
            <button onClick={() => setIsSessionPopupOpen(false)} type="button">Close</button>
          </header>
          <div className="admin-video-analysis__popup-body">
            <SessionAnalysisPanel
              eyebrow="Rule-based result"
              session={activePopupSession}
            />
            <EngineTimelinePanel expectedReps={expectedReps} result={activePopupResult} />
          </div>
        </section>
      ) : null}
    </main>
  );
}
