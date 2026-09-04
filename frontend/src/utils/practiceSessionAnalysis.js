import { scorePracticeAngles } from "./practiceAngleScoring.js";

const PHASE_LABELS = Object.freeze({
  waiting_for_movement: "Preparation",
  seeking_step: "Seeking",
  between_steps: "Entry",
  step_enter: "Entry",
  step_hold: "Hold",
  step_peak: "Peak",
  step_exit: "Exit",
  rep_peak: "Peak",
  rep_recovery: "Recovery",
  rep_complete: "Complete",
  session_complete: "Complete",
  tracking_lost: "Tracking lost"
});

const finiteAverage = (values) => {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return finite.reduce((total, value) => total + value, 0) / finite.length;
};

const frameRuleState = (frame) =>
  frame?.ruleEngineAnalysis?.corrected ||
  frame?.ruleEngineAnalysis?.raw ||
  null;

const frameErrors = (frame) => {
  const ruleErrors = frameRuleState(frame)?.form_errors;
  return [
    ...(Array.isArray(frame?.wrongBodyParts) ? frame.wrongBodyParts : []),
    ...(Array.isArray(ruleErrors) ? ruleErrors : [])
  ];
};

const CLUSTER_EVIDENCE_PHASES = new Set([
  "step_enter",
  "step_hold",
  "step_peak",
  "step_exit",
  "rep_peak",
  "rep_recovery",
  "rep_complete",
  "session_complete"
]);

const PROGRESSION_PHASES = new Set([
  "between_steps",
  "step_enter",
  "step_hold",
  "step_peak",
  "step_exit",
  "rep_peak",
  "rep_recovery",
  "rep_complete",
  "session_complete"
]);

// Form accuracy belongs to confirmed poses, not the travel into or out of a
// pose. Raw live `phase` labels can remain "transition" for fast actions, so
// post-session canonical phases are the scoring authority.
const SCORABLE_ANALYSIS_PHASES = new Set([
  "step_hold",
  "step_peak",
  "rep_peak",
  "rep_complete",
  "session_complete"
]);

function hasClusterEvidence(frame) {
  return (
    CLUSTER_EVIDENCE_PHASES.has(frame?.temporalPhase) ||
    (Number.isInteger(Number(frame?.matchedStep)) &&
      Number(frame.matchedStep) > 0) ||
    (Number.isInteger(Number(frame?.completedRep)) &&
      Number(frame.completedRep) > 0)
  );
}

const DEFAULT_CLUSTER_CONFIG = Object.freeze({
  impact_step: 2,
  minimum_impact_score: 80,
  impact_dominance_margin: 6,
  minimum_impact_frames: 3,
  maximum_impact_gap_frames: 2,
  maximum_impact_duration_ms: 2500,
  minimum_return_score: 75,
  return_dominance_margin: 5,
  minimum_return_frames: 3,
  maximum_evidence_gap_ms: 500,
  preparation_context_ms: 900,
  maximum_recovery_ms: 1200
});

function sourceSampleKey(frame, index) {
  const sourceTimestamp = Number(frame?.sourceTimestampMs);
  return Number.isFinite(sourceTimestamp) ? `source:${sourceTimestamp}` : `frame:${index}`;
}

function sourceSampleTimestamp(frame) {
  const sourceTimestamp = Number(frame?.sourceTimestampMs);
  return Number.isFinite(sourceTimestamp)
    ? sourceTimestamp
    : Number(frame?.elapsedMs) || 0;
}

function buildCompletionEvents(frames) {
  const events = [];
  let highestCompletedRep = 0;

  frames.forEach((frame, index) => {
    const completedRep = Number(frame?.completedRep);
    if (!Number.isInteger(completedRep) || completedRep <= highestCompletedRep) return;
    for (let rep = highestCompletedRep + 1; rep <= completedRep; rep += 1) {
      events.push({
        rep,
        index,
        post_session_authoritative: frame?.postSessionClassified === true,
        authoritative:
          frame?.postSessionClassified === true ||
          Number(frame?.rep) > rep ||
          frame?.temporalPhase === "session_complete"
      });
    }
    highestCompletedRep = completedRep;
  });

  return events;
}

function buildCompletionDrivenWindows(
  frames,
  preparationContextMs = 900,
  maximumRepetitions = null
) {
  const authoritativeEvents = buildCompletionEvents(frames)
    .filter((event) => event.post_session_authoritative)
    .filter((event, index, events) =>
      index === 0 || event.index > events[index - 1].index
    );
  const limit = Number(maximumRepetitions);
  const events = Number.isInteger(limit) && limit > 0
    ? authoritativeEvents.slice(0, limit)
    : authoritativeEvents;

  let previousEndIndex = -1;
  return events.map((event, eventIndex) => {
    const intervalStart = previousEndIndex + 1;
    const intervalEnd = event.index;
    const progressionIndex = frames.findIndex(
      (frame, index) =>
        index >= intervalStart &&
        index <= intervalEnd &&
        Number(frame?.step) > 1 &&
        PROGRESSION_PHASES.has(frame?.temporalPhase)
    );
    const anchorIndex = progressionIndex >= 0 ? progressionIndex : intervalEnd;
    const anchorMs = Number(frames[anchorIndex]?.elapsedMs) || 0;
    const earliestContextMs = Math.max(0, anchorMs - preparationContextMs);
    let startIndex = anchorIndex;

    for (let index = intervalStart; index <= anchorIndex; index += 1) {
      const frame = frames[index];
      if (
        (Number(frame?.elapsedMs) || 0) >= earliestContextMs &&
        Number(frame?.step) === 1 &&
        hasClusterEvidence(frame)
      ) {
        startIndex = index;
        break;
      }
    }

    if (startIndex === anchorIndex) {
      const firstEvidenceIndex = frames.findIndex(
        (frame, index) =>
          index >= intervalStart &&
          index <= anchorIndex &&
          hasClusterEvidence(frame)
      );
      if (firstEvidenceIndex >= 0) startIndex = firstEvidenceIndex;
    }

    const window = {
      rep: eventIndex + 1,
      source_rep: event.rep,
      start_index: Math.max(intervalStart, startIndex),
      end_index: Math.max(startIndex, intervalEnd),
      progression_index: anchorIndex,
      has_completion_signal: true,
      classifier_completion_signal: true,
      boundary_source: "post_session_completion"
    };
    previousEndIndex = window.end_index;
    return window;
  });
}

function buildStrictRuleWindows(
  frames,
  preparationContextMs = 900,
  maximumRepetitions = null
) {
  const repIndexes = new Map();
  frames.forEach((frame, index) => {
    const state = frameRuleState(frame);
    const rep = Number(state?.rep_id);
    if (!Number.isInteger(rep) || rep <= 0) return;
    const indexes = repIndexes.get(rep) || [];
    indexes.push(index);
    repIndexes.set(rep, indexes);
  });

  const maximum = Number(maximumRepetitions);
  const completed = [...repIndexes.entries()]
    .filter(([, indexes]) => indexes.some(
      (index) => frameRuleState(frames[index])?.rep_state === "REP_COMPLETED"
    ))
    .sort(([first], [second]) => first - second);
  const limited = Number.isInteger(maximum) && maximum > 0
    ? completed.slice(0, maximum)
    : completed;

  let previousEndIndex = -1;
  return limited.map(([sourceRep, indexes], windowIndex) => {
    const progressionIndex = indexes[0];
    const strictRepEndIndex = indexes[indexes.length - 1];
    let endIndex = strictRepEndIndex;
    const strictEndMs = Number(frames[strictRepEndIndex]?.elapsedMs) || 0;
    for (let index = strictRepEndIndex + 1; index < frames.length; index += 1) {
      const elapsedMs = Number(frames[index]?.elapsedMs) || 0;
      if (elapsedMs - strictEndMs > 1200) break;
      const state = frameRuleState(frames[index]);
      if (Number.isInteger(Number(state?.rep_id)) && Number(state.rep_id) > 0) break;
      if (!state?.tracking_lost && state?.step === "GUARD") {
        endIndex = index;
        break;
      }
    }
    const progressionMs = Number(frames[progressionIndex]?.elapsedMs) || 0;
    const earliestContextMs = Math.max(
      0,
      progressionMs - Number(preparationContextMs || 900)
    );
    let startIndex = progressionIndex;
    for (let index = progressionIndex - 1; index > previousEndIndex; index -= 1) {
      const elapsedMs = Number(frames[index]?.elapsedMs) || 0;
      if (elapsedMs < earliestContextMs) break;
      const state = frameRuleState(frames[index]);
      if (!state?.tracking_lost && state?.step === "GUARD") startIndex = index;
    }
    const window = {
      rep: windowIndex + 1,
      source_rep: sourceRep,
      start_index: Math.max(previousEndIndex + 1, startIndex),
      end_index: endIndex,
      progression_index: progressionIndex,
      strict_rep_end_index: strictRepEndIndex,
      has_completion_signal: true,
      classifier_completion_signal: false,
      strict_completion_signal: true,
      strict_driven: true,
      boundary_source: "strict_rule_replay"
    };
    previousEndIndex = endIndex;
    return window;
  });
}

function buildScoreDrivenWindows(frames, config = {}) {
  const settings = { ...DEFAULT_CLUSTER_CONFIG, ...(config || {}) };
  const impactStepIndex = Math.max(0, Number(settings.impact_step) - 1);
  const hasScoreEvidence = frames.some(
    (frame) =>
      Array.isArray(frame.stepScores) &&
      frame.stepScores.length > impactStepIndex + 1
  );
  if (!hasScoreEvidence || impactStepIndex <= 0) return [];

  const scoreAt = (frame, index) =>
    Number(frame?.stepScores?.[index]) || 0;
  const endpointScore = (frame) =>
    Math.max(
      scoreAt(frame, 0),
      scoreAt(frame, Math.max(0, frame.stepScores.length - 1))
    );
  const isImpact = (frame) => {
    const impactScore = scoreAt(frame, impactStepIndex);
    return (
      impactScore >= Number(settings.minimum_impact_score) &&
      impactScore - endpointScore(frame) >=
      Number(settings.impact_dominance_margin)
    );
  };
  const isEndpoint = (frame) => {
    const impactScore = scoreAt(frame, impactStepIndex);
    const returnScore = endpointScore(frame);
    return (
      returnScore >= Number(settings.minimum_return_score) &&
      returnScore - impactScore >= Number(settings.return_dominance_margin)
    );
  };
  const impactIndexes = frames
    .map((frame, index) => (isImpact(frame) ? index : null))
    .filter(Number.isInteger);
  if (!impactIndexes.length) return [];

  const impactRuns = [];
  impactIndexes.forEach((index) => {
    const current = impactRuns[impactRuns.length - 1];
    const sampleKey = sourceSampleKey(frames[index], index);
    const sampleTimestamp = sourceSampleTimestamp(frames[index]);
    if (
      current &&
      index - current.end <= Number(settings.maximum_impact_gap_frames) + 1 &&
      sampleTimestamp - current.last_sample_timestamp <=
        Number(settings.maximum_evidence_gap_ms)
    ) {
      current.end = index;
      if (sampleKey !== current.last_sample_key) {
        current.confirmed_frames += 1;
        current.last_sample_key = sampleKey;
        current.last_sample_timestamp = sampleTimestamp;
      }
      return;
    }
    impactRuns.push({
      start: index,
      end: index,
      confirmed_frames: 1,
      last_sample_key: sampleKey,
      last_sample_timestamp: sampleTimestamp
    });
  });
  let confirmedRuns = impactRuns.filter(
    (run) => {
      const durationMs = Math.max(
        0,
        (Number(frames[run.end]?.elapsedMs) || 0) -
          (Number(frames[run.start]?.elapsedMs) || 0)
      );
      return (
        run.confirmed_frames >= Number(settings.minimum_impact_frames) &&
        durationMs <= Number(settings.maximum_impact_duration_ms)
      );
    }
  );
  const maximumRepetitions = Number(settings.maximum_repetitions);
  if (
    Number.isInteger(maximumRepetitions) &&
    maximumRepetitions > 0 &&
    confirmedRuns.length > maximumRepetitions
  ) {
    const firstCueMs = Math.min(
      ...frames
        .map((frame) => Number(frame.countTimestampMs))
        .filter(Number.isFinite)
    );
    const postCueRuns = Number.isFinite(firstCueMs)
      ? confirmedRuns.filter(
          (run) =>
            (Number(frames[run.end]?.elapsedMs) || 0) >= firstCueMs - 500
        )
      : [];
    confirmedRuns = (
      postCueRuns.length >= maximumRepetitions
        ? postCueRuns
        : confirmedRuns
    ).slice(0, maximumRepetitions);
  }

  const completionEvents = buildCompletionEvents(frames);
  let previousEndIndex = -1;
  return confirmedRuns.map((run, runIndex) => {
    const impactStartMs = Number(frames[run.start]?.elapsedMs) || 0;
    const earliestContextMs = Math.max(
      0,
      impactStartMs - Number(settings.preparation_context_ms)
    );
    let startIndex = run.start;
    while (
      startIndex > previousEndIndex + 1 &&
      (Number(frames[startIndex - 1]?.elapsedMs) || 0) >= earliestContextMs
    ) {
      startIndex -= 1;
    }
    let openingRunStart = null;
    let openingRunLength = 0;
    let openingSampleKey = null;
    let confirmedOpeningStart = null;
    let confirmedOpeningEnd = null;
    for (let index = startIndex; index < run.start; index += 1) {
      if (isEndpoint(frames[index])) {
        if (openingRunStart === null) openingRunStart = index;
        const sampleKey = sourceSampleKey(frames[index], index);
        if (sampleKey !== openingSampleKey) {
          openingRunLength += 1;
          openingSampleKey = sampleKey;
        }
        if (
          openingRunLength >= Number(settings.minimum_return_frames)
        ) {
          confirmedOpeningStart = openingRunStart;
          confirmedOpeningEnd = index;
        }
      } else {
        openingRunStart = null;
        openingRunLength = 0;
        openingSampleKey = null;
      }
    }

    const nextImpactStart =
      confirmedRuns[runIndex + 1]?.start ?? frames.length;
    const maximumRecoveryMs =
      (Number(frames[run.end]?.elapsedMs) || 0) +
      Number(settings.maximum_recovery_ms);
    let returnRunStart = null;
    let returnRunLength = 0;
    let returnSampleKey = null;
    let endIndex = run.end;
    for (
      let index = run.end + 1;
      index < nextImpactStart &&
      index < frames.length &&
      (Number(frames[index]?.elapsedMs) || 0) <= maximumRecoveryMs;
      index += 1
    ) {
      if (isEndpoint(frames[index])) {
        if (returnRunStart === null) returnRunStart = index;
        const sampleKey = sourceSampleKey(frames[index], index);
        if (sampleKey !== returnSampleKey) {
          returnRunLength += 1;
          returnSampleKey = sampleKey;
        }
        if (returnRunLength >= Number(settings.minimum_return_frames)) {
          endIndex = index;
          break;
        }
      } else {
        returnRunStart = null;
        returnRunLength = 0;
        returnSampleKey = null;
      }
      endIndex = index;
    }
    const hasReturnSignal =
      returnRunStart !== null &&
      returnRunLength >= Number(settings.minimum_return_frames);
    if (!hasReturnSignal) {
      endIndex = Math.max(
        run.end,
        Math.min(endIndex, nextImpactStart - 1)
      );
    }

    const sourceRep = Number(frames[run.start]?.rep) || null;
    const classifierCompletion = completionEvents.find(
      (event) =>
        event.rep === sourceRep &&
        event.index >= run.start &&
        event.index < nextImpactStart
    );
    if (classifierCompletion) {
      endIndex = Math.max(endIndex, classifierCompletion.index);
    }
    const window = {
      rep: runIndex + 1,
      source_rep: sourceRep,
      start_index: Math.max(previousEndIndex + 1, startIndex),
      end_index: Math.max(run.end, endIndex),
      progression_index: run.start,
      impact_start_index: run.start,
      impact_end_index: run.end,
      opening_start_index: confirmedOpeningStart,
      opening_end_index: confirmedOpeningEnd,
      return_start_index: hasReturnSignal ? returnRunStart : null,
      has_completion_signal: hasReturnSignal || Boolean(classifierCompletion),
      classifier_completion_signal: Boolean(classifierCompletion?.authoritative),
      boundary_source: classifierCompletion
        ? "score_cycle_and_classifier"
        : "score_cycle"
    };
    previousEndIndex = window.end_index;
    return window;
  });
}

function buildClassifierDrivenWindows(frames, preparationContextMs = 900) {
  const completionEvents = buildCompletionEvents(frames);
  const sourceRepIds = [
    ...new Set(
      frames
        .map((frame) => Number(frame.rep))
        .filter((rep) => Number.isInteger(rep) && rep > 0)
    )
  ].sort((first, second) => first - second);
  const windows = [];

  sourceRepIds.forEach((sourceRep) => {
    const repIndexes = frames
      .map((frame, index) => ({ frame, index }))
      .filter(({ frame }) => Number(frame.rep) === sourceRep);
    const progression = repIndexes.find(({ frame }) =>
      Number(frame.step) > 1 && PROGRESSION_PHASES.has(frame.temporalPhase)
    );
    if (!progression) return;

    const anchorMs = Number(progression.frame.elapsedMs) || 0;
    const earliestContextMs = Math.max(0, anchorMs - preparationContextMs);
    const openingContext = repIndexes.filter(({ frame, index }) =>
      index <= progression.index &&
      (Number(frame.elapsedMs) || 0) >= earliestContextMs &&
      Number(frame.step) === 1 &&
      hasClusterEvidence(frame)
    );
    const completionEvent = completionEvents.find(
      (event) => event.rep === sourceRep && event.index >= progression.index
    );
    const phaseCompletion = [...repIndexes].reverse().find(({ frame }) =>
      ["rep_complete", "session_complete"].includes(frame.temporalPhase)
    );
    const completion = completionEvent
      ? { frame: frames[completionEvent.index], index: completionEvent.index }
      : phaseCompletion;
    const lastEvidence = [...repIndexes].reverse().find(({ frame }) =>
      hasClusterEvidence(frame)
    );
    const previousWindow = windows[windows.length - 1];
    const startIndex = Math.max(
      previousWindow ? previousWindow.end_index + 1 : 0,
      openingContext[0]?.index ?? progression.index
    );
    const endIndex = Math.max(
      startIndex,
      completion?.index ?? lastEvidence?.index ?? progression.index
    );

    windows.push({
      rep: windows.length + 1,
      source_rep: sourceRep,
      start_index: startIndex,
      end_index: endIndex,
      progression_index: progression.index,
      has_completion_signal: Boolean(completion),
      classifier_completion_signal: Boolean(completionEvent?.authoritative),
      boundary_source: completionEvent ? "classifier_completion" : "classifier"
    });
  });

  return windows;
}

function buildMovementDrivenWindows(
  frames,
  preparationContextMs = 900,
  clusterConfig = {}
) {
  const completionWindows = buildCompletionDrivenWindows(
    frames,
    preparationContextMs,
    clusterConfig?.maximum_repetitions
  );
  const classifierWindows = buildClassifierDrivenWindows(
    frames,
    preparationContextMs
  );
  const scoreDrivenWindows = buildScoreDrivenWindows(frames, {
    ...clusterConfig,
    preparation_context_ms:
      clusterConfig?.preparation_context_ms ?? preparationContextMs
  });
  if (!scoreDrivenWindows.length && !completionWindows.length) {
    return classifierWindows;
  }

  const merged = completionWindows.length
    ? [...completionWindows]
    : [...scoreDrivenWindows];
  const fallbackWindows = completionWindows.length
    ? [...scoreDrivenWindows, ...classifierWindows]
    : classifierWindows;
  fallbackWindows.forEach((classifierWindow) => {
    const alreadyRepresented = merged.some((existingWindow) =>
      existingWindow.source_rep === classifierWindow.source_rep ||
      (
        classifierWindow.progression_index >= existingWindow.start_index &&
        classifierWindow.progression_index <= existingWindow.end_index
      )
    );
    const occursAfterCompletedSet = completionWindows.length &&
      classifierWindow.progression_index > completionWindows.at(-1).end_index;
    if (
      !alreadyRepresented &&
      (classifierWindow.classifier_completion_signal || occursAfterCompletedSet)
    ) {
      merged.push(classifierWindow);
    }
  });

  return merged
    .sort((first, second) => first.start_index - second.start_index)
    .map((window, index) => ({ ...window, rep: index + 1 }));
}

function frameKind(frame) {
  if (frame.temporalPhase === "tracking_lost") return "tracking";
  if (
    frame.temporalPhase === "session_complete" &&
    frame.analysisKind !== "repetition"
  ) {
    return "complete";
  }
  return frame.analysisKind || "preparation";
}

function segmentKey(frame) {
  const kind = frameKind(frame);
  const phase = frame.analysisPhase ?? frame.temporalPhase;
  if (kind !== "repetition") return `${kind}:${phase || ""}`;
  return [
    kind,
    Number(frame.analysisRep) || 1,
    Number(frame.analysisStep ?? frame.step) || 1,
    phase || "seeking_step"
  ].join(":");
}

function closeSegment(segment, frames) {
  const segmentFrames = frames.slice(
    segment.start_frame_index,
    segment.end_frame_index + 1
  );
  const accuracies = segmentFrames
    .filter((frame) => frame.analysisScorable)
    .map((frame) => Number(frame.accuracy));
  const errors = new Set(
    segmentFrames
      .filter((frame) => frame.analysisScorable)
      .flatMap(frameErrors)
  );
  const confidence = finiteAverage(
    segmentFrames.map((frame) => Number(frame.stateConfidence))
  );
  return {
    ...segment,
    frame_count: segmentFrames.length,
    duration_ms: Math.max(0, segment.end_ms - segment.start_ms),
    average_accuracy: finiteAverage(accuracies),
    confidence,
    errors: [...errors],
    has_review: errors.size > 0 ||
      accuracies.some((accuracy) => Number.isFinite(accuracy) && accuracy < 80)
  };
}

export function buildPracticeSessionAnalysis(
  frames,
  {
    steps = [],
    targetReps = null,
    strictSummary = null,
    clusterConfig = null
  } = {}
) {
  const orderedFrames = [...(frames || [])].sort(
    (first, second) =>
      Number(first.elapsedMs || 0) - Number(second.elapsedMs || 0)
  );
  if (!orderedFrames.length) {
    return {
      segments: [],
      repetitions: [],
      frame_assignments: [],
      preparation_duration_ms: 0,
      tracking_quality_percentage: 0,
      clustered_completed_repetitions: 0,
      strict_verified_repetitions:
        strictSummary?.completed_repetitions || 0,
      target_repetitions: Number(targetReps) || 0
    };
  }

  const movementWindows = buildMovementDrivenWindows(
    orderedFrames,
    clusterConfig?.preparation_context_ms,
    {
      ...(clusterConfig || {}),
      maximum_repetitions: Number(targetReps) || null
    }
  );
  const strictWindows = buildStrictRuleWindows(
    orderedFrames,
    clusterConfig?.preparation_context_ms,
    Number(targetReps) || null
  );
  const strictCompleted = Number(strictSummary?.completed_repetitions) || 0;
  const useStrictWindows =
    strictCompleted > 0 &&
    strictWindows.length === strictCompleted;
  const repetitionWindows = useStrictWindows ? strictWindows : movementWindows;
  const analysisFrames = orderedFrames.map((frame, index) => {
    const window = repetitionWindows.find(
      (candidate) =>
        index >= candidate.start_index && index <= candidate.end_index
    );
    const isScoreDriven = window?.impact_start_index !== undefined;
    const isStrictDriven = window?.strict_driven === true;
    const strictState = frameRuleState(frame);
    const isImpactFrame =
      isScoreDriven &&
      index >= window.impact_start_index &&
      index <= window.impact_end_index;
    const isConfirmedOpeningFrame =
      isScoreDriven &&
      Number.isInteger(window.opening_start_index) &&
      index >= window.opening_start_index &&
      index <= window.opening_end_index;
    const isConfirmedReturnFrame =
      isScoreDriven &&
      Number.isInteger(window.return_start_index) &&
      index >= window.return_start_index;
    const isTransitionFrame =
      isScoreDriven &&
      !isConfirmedOpeningFrame &&
      !isImpactFrame &&
      !isConfirmedReturnFrame;
    const strictCanonicalPhase = strictState?.canonical_phase || strictState?.phase;
    const analysisStep = isStrictDriven
      ? index < window.progression_index
        ? 1
        : index > window.strict_rep_end_index
          ? Math.max(
            Number(clusterConfig?.impact_step) || DEFAULT_CLUSTER_CONFIG.impact_step,
            steps.length || 3
          )
        : ["EXTENSION", "PEAK"].includes(strictCanonicalPhase)
          ? Number(clusterConfig?.impact_step) || DEFAULT_CLUSTER_CONFIG.impact_step
          : ["RETRACTION", "RECOVERY"].includes(strictCanonicalPhase)
            ? Math.max(
              Number(clusterConfig?.impact_step) || DEFAULT_CLUSTER_CONFIG.impact_step,
              steps.length || 3
            )
            : 1
      : !isScoreDriven
      ? Number(frame.step) || null
      : index < window.impact_start_index
        ? isConfirmedOpeningFrame ? 1 : null
        : isImpactFrame
          ? Number(clusterConfig?.impact_step) ||
            DEFAULT_CLUSTER_CONFIG.impact_step
          : isConfirmedReturnFrame
            ? Math.max(
              Number(clusterConfig?.impact_step) ||
                DEFAULT_CLUSTER_CONFIG.impact_step,
              steps.length || 3
            )
            : null;
    const impactProgress = !isScoreDriven
      ? null
      : (index - window.impact_start_index) /
        Math.max(1, window.impact_end_index - window.impact_start_index);
    const analysisPhase = isStrictDriven
      ? index < window.progression_index
        ? "step_enter"
        : index > window.strict_rep_end_index
          ? "rep_complete"
        : strictCanonicalPhase === "PEAK"
          ? "step_peak"
          : strictCanonicalPhase === "RECOVERY"
            ? "step_enter"
            : strictCanonicalPhase === "RETRACTION"
              ? "step_enter"
              : "step_enter"
      : !isScoreDriven
      ? frame.temporalPhase
      : index < window.impact_start_index
        ? isConfirmedOpeningFrame ? "step_hold" : "between_steps"
        : isImpactFrame
          ? impactProgress < 0.25
            ? "step_enter"
            : impactProgress < 0.75
              ? "step_peak"
              : "step_exit"
          : isConfirmedReturnFrame
            ? index === window.end_index
              ? "rep_complete"
              : "step_hold"
            : "rep_recovery";
    const analysisScorable =
      Boolean(window) &&
      frame.trackingReliable !== false &&
      Number.isInteger(analysisStep) &&
      !isTransitionFrame &&
      SCORABLE_ANALYSIS_PHASES.has(analysisPhase);
    const scoringTargets = Number.isInteger(analysisStep)
      ? steps[Math.max(0, analysisStep - 1)]?.angles || []
      : [];
    const scoringResult = analysisScorable && scoringTargets.length
      ? scorePracticeAngles(
          scoringTargets,
          frame.angles || {}
        )
      : null;
    return {
      ...frame,
      accuracy: scoringResult?.accuracy ?? (analysisScorable ? frame.accuracy : null),
      focusBodyPart:
        scoringResult?.focusBodyPart ?? (analysisScorable ? frame.focusBodyPart : null),
      issue:
        scoringResult?.issue ?? (analysisScorable ? frame.issue : "transition"),
      wrongBodyParts:
        scoringResult?.wrongBodyParts || (analysisScorable ? frame.wrongBodyParts : []) || [],
      advisoryBodyParts:
        scoringResult?.advisoryBodyParts ||
        (analysisScorable ? frame.advisoryBodyParts : []) ||
        [],
      analysisKind: window ? "repetition" : "preparation",
      analysisRep: window?.rep ?? null,
      analysisStep,
      analysisPhase,
      analysisScorable,
      sourceRep: Number(frame.rep) || null
    };
  });
  const rawSegments = [];
  analysisFrames.forEach((frame, index) => {
    const key = segmentKey(frame);
    const elapsedMs = Number(frame.elapsedMs) || 0;
    const current = rawSegments[rawSegments.length - 1];
    if (current?.key === key) {
      current.end_frame_index = index;
      current.end_ms = elapsedMs;
      return;
    }
    rawSegments.push({
      key,
      kind: frameKind(frame),
      rep: Number(frame.analysisRep) || null,
      step: Number(frame.analysisStep ?? frame.step) || null,
      step_name:
        steps[
          Math.max(0, (Number(frame.analysisStep ?? frame.step) || 1) - 1)
        ]?.step_name ||
        (frame.analysisStep ?? frame.step
          ? `Step ${frame.analysisStep ?? frame.step}`
          : "Preparation"),
      phase: frame.analysisPhase ?? frame.temporalPhase ?? "seeking_step",
      phase_label:
        frameKind(frame) === "unconfirmed"
          ? "Unconfirmed"
          : PHASE_LABELS[frame.analysisPhase ?? frame.temporalPhase] ||
            "Movement",
      start_frame_index: index,
      end_frame_index: index,
      start_ms: elapsedMs,
      end_ms: elapsedMs
    });
  });
  const segments = rawSegments.map((segment) =>
    closeSegment(segment, analysisFrames)
  );

  const repetitions = repetitionWindows.map((window) => {
    const rep = window.rep;
    const repFrames = analysisFrames.filter(
      (frame) =>
        frameKind(frame) === "repetition" &&
        Number(frame.analysisRep) === rep
    );
    const repSegments = segments.filter(
      (segment) => segment.kind === "repetition" && segment.rep === rep
    );
    const errors = new Set(
      repFrames
        .filter((frame) => frame.analysisScorable)
        .flatMap(frameErrors)
    );
    const accuracies = repFrames
      .filter((frame) => frame.analysisScorable)
      .map((frame) => Number(frame.accuracy));
    const detectedSteps = new Set(
      repSegments
        .filter((segment) => segment.phase !== "seeking_step")
        .map((segment) => segment.step)
    );
    const hasCompletionSignal = window.has_completion_signal;
    const hasFullStepCoverage =
      !steps.length || detectedSteps.size >= steps.length;
    const status =
      window.classifier_completion_signal ||
      window.strict_completion_signal ||
      (hasCompletionSignal && hasFullStepCoverage)
        ? "completed"
        : hasCompletionSignal
          ? "partial"
          : "incomplete";
    const strictRepetition = window.strict_driven && Array.isArray(strictSummary?.repetitions)
      ? strictSummary.repetitions.find(
          (repetition) => Number(repetition?.rep_id) === Number(window.source_rep)
        )
      : null;
    const strictQuality = Number(strictRepetition?.technique_quality);
    const strictDurationMs = Number(strictRepetition?.duration_ms);
    return {
      rep,
      status,
      start_frame_index: repSegments[0]?.start_frame_index ?? 0,
      end_frame_index:
        repSegments[repSegments.length - 1]?.end_frame_index ?? 0,
      start_ms: repSegments[0]?.start_ms ?? 0,
      end_ms: repSegments[repSegments.length - 1]?.end_ms ?? 0,
      duration_ms: Number.isFinite(strictDurationMs)
        ? strictDurationMs
        : Math.max(
            0,
            (repSegments[repSegments.length - 1]?.end_ms ?? 0) -
              (repSegments[0]?.start_ms ?? 0)
          ),
      average_accuracy: Number.isFinite(strictQuality)
        ? strictQuality * 100
        : finiteAverage(accuracies),
      confidence: finiteAverage(
        repFrames.map((frame) => Number(frame.stateConfidence))
      ),
      detected_steps: [...detectedSteps],
      step_coverage_percentage: steps.length
        ? Math.round((detectedSteps.size / steps.length) * 100)
        : 0,
      errors: [...errors],
      segments: repSegments
    };
  });

  const preparationSegments = segments.filter(
    (segment) => segment.kind === "preparation"
  );
  const trackedFrames = orderedFrames.filter(
    (frame) =>
      frame.trackingReliable !== false &&
      !frameRuleState(frame)?.tracking_lost
  );

  return {
    segments,
    repetitions,
    frame_assignments: analysisFrames.map((frame, index) => ({
      index,
      kind: frameKind(frame),
      rep: frame.analysisRep,
      step: frame.analysisStep,
      phase: frame.analysisPhase,
      scorable: frame.analysisScorable,
      accuracy: frame.accuracy,
      focus_body_part: frame.focusBodyPart,
      issue: frame.issue,
      wrong_body_parts: frame.wrongBodyParts,
      advisory_body_parts: frame.advisoryBodyParts,
      source_rep: frame.sourceRep
    })),
    preparation_duration_ms: preparationSegments.reduce(
      (total, segment) => total + segment.duration_ms,
      0
    ),
    tracking_quality_percentage: Math.round(
      (trackedFrames.length / orderedFrames.length) * 100
    ),
    clustered_completed_repetitions: repetitions.filter(
      (repetition) => repetition.status === "completed"
    ).length,
    clustered_incomplete_repetitions: repetitions.filter(
      (repetition) => repetition.status !== "completed"
    ).length,
    unconfirmed_duration_ms: segments
      .filter((segment) => segment.kind === "unconfirmed")
      .reduce((total, segment) => total + segment.duration_ms, 0),
    strict_verified_repetitions:
      Number(strictSummary?.completed_repetitions) || 0,
    strict_incomplete_repetitions:
      Number(strictSummary?.aborted_repetitions) || 0,
    target_repetitions: Number(targetReps) || repetitions.length,
    duration_ms:
      Number(orderedFrames[orderedFrames.length - 1]?.elapsedMs) || 0
  };
}

export function buildPracticeSessionMetrics(
  analysis,
  { cleanAccuracy = 80 } = {}
) {
  const completed = (analysis?.repetitions || []).filter(
    (repetition) => repetition.status === "completed"
  );
  const accuracies = completed
    .map((repetition) => repetition.average_accuracy)
    .filter((accuracy) => accuracy !== null && accuracy !== undefined)
    .map(Number)
    .filter(Number.isFinite);
  const durations = completed
    .map((repetition) => Number(repetition.duration_ms))
    .filter(Number.isFinite);
  const averageAccuracy = accuracies.length
    ? accuracies.reduce((total, value) => total + value, 0) /
      accuracies.length
    : 0;
  const variance = accuracies.length
    ? accuracies.reduce(
        (total, value) => total + (value - averageAccuracy) ** 2,
        0
      ) / accuracies.length
    : 0;

  return {
    completed_reps: completed.length,
    clean_reps: accuracies.filter((accuracy) => accuracy >= cleanAccuracy)
      .length,
    average_accuracy: Number(averageAccuracy.toFixed(2)),
    best_accuracy: accuracies.length ? Math.max(...accuracies) : 0,
    average_rep_seconds: durations.length
      ? Number(
          (
            durations.reduce((total, value) => total + value, 0) /
            durations.length /
            1000
          ).toFixed(3)
        )
      : 0,
    consistency_score: accuracies.length
      ? Number(Math.max(0, 100 - Math.sqrt(variance)).toFixed(2))
      : 0
  };
}

export function selectPracticeTimelineView(analysis, { advanced = false } = {}) {
  const allSegments = analysis?.segments || [];
  const firstScoredIndex = allSegments.findIndex(
    (segment) =>
      segment.kind === "repetition" &&
      Number.isFinite(segment.average_accuracy)
  );
  const lastScoredIndex = allSegments.findLastIndex(
    (segment) =>
      segment.kind === "repetition" &&
      Number.isFinite(segment.average_accuracy)
  );
  const visibleSegments =
    advanced || firstScoredIndex < 0 || lastScoredIndex < firstScoredIndex
      ? allSegments
      : allSegments.slice(firstScoredIndex, lastScoredIndex + 1);
  const fallbackStart = Number(analysis?.repetitions?.[0]?.start_ms) || 0;
  const fallbackEnd =
    Number(analysis?.repetitions?.at(-1)?.end_ms) ||
    Number(analysis?.duration_ms) ||
    0;
  const startMs =
    Number(visibleSegments[0]?.start_ms) || fallbackStart;
  const endMs =
    Number(visibleSegments.at(-1)?.end_ms) || fallbackEnd;

  return {
    segments: visibleSegments,
    start_ms: advanced ? 0 : startMs,
    end_ms: advanced
      ? Math.max(Number(analysis?.duration_ms) || 0, endMs)
      : Math.max(startMs, endMs),
    hidden_segment_count: Math.max(0, allSegments.length - visibleSegments.length)
  };
}
