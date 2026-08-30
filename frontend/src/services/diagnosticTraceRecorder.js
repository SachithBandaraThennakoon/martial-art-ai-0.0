const DEFAULT_SAMPLE_INTERVAL_MS = 200;
const DEFAULT_PIPELINE_INTERVAL_MS = 1000;
const DEFAULT_MAX_RECORDS = 12000;

const round = (value, digits = 4) => {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
};

const compactPoint = (point) => [
  round(point?.x),
  round(point?.y),
  round(point?.z),
  round(point?.visibility)
];

const compactLandmarks = (landmarks) => {
  if (!landmarks) return [];
  if (Array.isArray(landmarks) || ArrayBuffer.isView(landmarks)) {
    return Array.from(landmarks).map((point) => compactPoint(point));
  }
  if (typeof landmarks === "object") {
    if ("x" in landmarks && "y" in landmarks) return compactPoint(landmarks);
    return Object.fromEntries(
      Object.entries(landmarks).map(([key, value]) => [key, compactLandmarks(value)])
    );
  }
  return [];
};

const compactAngles = (angles) => Object.fromEntries(
  Object.entries(angles || {}).map(([key, value]) => [key, round(value, 2)])
);

const compactComposite = (form) => ({
  accuracy: round(form?.accuracy, 2),
  coverage: round(form?.coverage, 2),
  scorable: Boolean(form?.scorable),
  corrections: (form?.corrections || []).map((item) => ({
    body_part: item.bodyPart,
    label: item.label,
    kind: item.kind,
    group: item.group,
    direction: item.direction,
    current: round(item.current, 2),
    ideal: round(item.ideal, 2),
    min: round(item.min, 2),
    max: round(item.max, 2),
    score: round(item.score, 2),
    weight: round(item.weight, 2)
  })),
  strengths: (form?.strengths || []).map((item) => ({
    body_part: item.bodyPart,
    label: item.label,
    group: item.group,
    current: round(item.current, 2),
    ideal: round(item.ideal, 2),
    score: round(item.score, 2)
  })),
  groups: form?.groupScores || form?.groups || null,
  temporal_evidence: (form?.temporalEvidence || []).map((item) => ({
    feature: item.feature,
    measured: item.measured,
    current: round(item.current, 3),
    operator: item.operator,
    target: round(item.target, 3),
    satisfied: item.satisfied,
    score: round(item.score, 2)
  }))
});

const compactLayer = (state, contextKey) => {
  if (!state) return null;
  return {
    ready: Boolean(
      state.ready_for_next_layer ||
      state.ready_for_situation_awareness ||
      state?.[contextKey]?.ready_for_level_4 ||
      state?.[contextKey]?.progression?.ready_for_level_5
    ),
    context: state[contextKey] || null
  };
};

const compactCoachEvent = (event) => event ? ({
  id: event.id || null,
  state: event.state || null,
  action: event.action || null,
  message: event.message || event.summary || "",
  voice_message: event.voice_message || event.message || event.summary || "",
  display_message: event.display_message || event.message || event.summary || "",
  feedback_detail: event.feedback_detail || null,
  speak: Boolean(event.speak),
  feedback_intent: event.feedback_intent || null,
  focus_body_part: event.focus_body_part || event.body_part || null,
  issue: event.issue || null,
  requires_response: Boolean(event.requires_response),
  question: event.question || null
}) : null;

const safeFilenamePart = (value) => String(value || "session")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || "session";

function sanitizePipelineValue(value, options = {}, state = null) {
  const settings = {
    maxArrayLength: options.maxArrayLength ?? 2048,
    maxDepth: options.maxDepth ?? 14,
    maxObjectKeys: options.maxObjectKeys ?? 300,
    maxStringLength: options.maxStringLength ?? 8000
  };
  const cursor = state || { depth: 0, seen: new WeakSet() };

  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "number") return round(value, 6);
  if (typeof value === "string") {
    return value.length <= settings.maxStringLength
      ? value
      : `${value.slice(0, settings.maxStringLength)}…[truncated]`;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (cursor.depth >= settings.maxDepth) return "[max-depth]";
  if (typeof value !== "object") return String(value);
  if (cursor.seen.has(value)) return "[circular]";

  cursor.seen.add(value);
  const childState = { depth: cursor.depth + 1, seen: cursor.seen };
  let result;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const source = Array.from(value);
    result = source
      .slice(0, settings.maxArrayLength)
      .map((item) => sanitizePipelineValue(item, settings, childState));
    if (source.length > settings.maxArrayLength) {
      result.push(`[${source.length - settings.maxArrayLength} more items]`);
    }
  } else if (value instanceof Date) {
    result = value.toISOString();
  } else {
    result = {};
    const entries = Object.entries(value).slice(0, settings.maxObjectKeys);
    entries.forEach(([key, item]) => {
      const sanitized = sanitizePipelineValue(item, settings, childState);
      if (sanitized !== undefined) result[key] = sanitized;
    });
    const keyCount = Object.keys(value).length;
    if (keyCount > settings.maxObjectKeys) {
      result.__truncated_keys__ = keyCount - settings.maxObjectKeys;
    }
  }
  cursor.seen.delete(value);
  return result;
}

export function createDiagnosticTraceRecorder({
  sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
  pipelineIntervalMs = DEFAULT_PIPELINE_INTERVAL_MS,
  maxRecords = DEFAULT_MAX_RECORDS,
  now = () => performance.now(),
  wallClock = () => new Date().toISOString()
} = {}) {
  let active = false;
  let startedAt = 0;
  let lastFrameAt = -Infinity;
  let lastPipelineAt = -Infinity;
  let metadata = {};
  let records = [];

  const append = (record) => {
    if (!active) return false;
    records.push(record);
    if (records.length > maxRecords) records = records.slice(-maxRecords);
    return true;
  };

  return {
    start(nextMetadata = {}) {
      records = [];
      metadata = nextMetadata;
      startedAt = now();
      lastFrameAt = -Infinity;
      lastPipelineAt = -Infinity;
      active = true;
      append({ type: "trace_started", elapsed_ms: 0, at: wallClock(), metadata });
    },

    stop(reason = "manual") {
      if (!active) return;
      append({
        type: "trace_stopped",
        elapsed_ms: Math.round(now() - startedAt),
        at: wallClock(),
        reason
      });
      active = false;
    },

    clear() {
      records = [];
      metadata = {};
      active = false;
      startedAt = 0;
      lastFrameAt = -Infinity;
      lastPipelineAt = -Infinity;
    },

    event(kind, payload = {}) {
      return append({
        type: "event",
        kind,
        elapsed_ms: Math.round(now() - startedAt),
        at: wallClock(),
        ...payload
      });
    },

    frame(frame, context = {}) {
      const timestamp = Number(frame?.timestamp ?? now());
      if (!active) return false;
      if (timestamp - lastPipelineAt >= pipelineIntervalMs) {
        lastPipelineAt = timestamp;
        append({
          type: "pipeline_snapshot",
          elapsed_ms: Math.round(now() - startedAt),
          source_timestamp_ms: round(timestamp, 2),
          pipeline: sanitizePipelineValue({
            stage_0_input: {
              observed_pose: frame?.observedPose || null,
              measurement_pose: frame?.measurementPose || null,
              face_points: frame?.facePoints || null,
              hand_points: frame?.handPoints || null
            },
            stage_1_perception: {
              filtered_pose: frame?.filteredPose || frame?.pose || null,
              display_pose: frame?.pose || null,
              aggregate_pose: frame?.aggregatePose || null,
              prediction_aggregate: frame?.predictionAggregate || null,
              display_pose_source: frame?.displayPoseSource || null,
              tracking_confidence: frame?.trackingConfidence,
              motion_energy: frame?.motionEnergy,
              angles: frame?.angles || context.liveAngles || {},
              awareness: context.awareness || null
            },
            stage_2_target_comparison: {
              targets: context.targets || [],
              difficulty: context.formDifficulty,
              mastery_threshold: context.masteryThreshold,
              composite_form: context.compositeForm || null
            },
            stage_3_level1_motion: context.level1State || null,
            stage_4_rule_engine: context.ruleEngineFrame || null,
            stage_4a_practice_classifier: context.practice || null,
            stage_5_level2_action: context.level2State || null,
            stage_6_level3_session: context.level3State || null,
            stage_7_level4_user: context.level4State || null,
            stage_8_situation_awareness: context.situationAwarenessState || null,
            stage_9_reasoning: context.situationAwarenessState?.situation_context?.reasoning || null,
            stage_10_plan: context.situationAwarenessState?.situation_context?.next_action || null,
            stage_11_action: context.situationAwarenessState?.situation_context?.feedback_decision || null,
            stage_12_feedback: context.coachEvent || null,
            stage_13_voice_and_turn: {
              voice: context.voice || null,
              session: context.session || null,
              step: context.step || null
            }
          })
        });
      }
      if (timestamp - lastFrameAt < sampleIntervalMs) return false;
      lastFrameAt = timestamp;
      const situation = context.situationAwarenessState?.situation_context || null;

      return append({
        type: "snapshot",
        elapsed_ms: Math.round(now() - startedAt),
        source_timestamp_ms: round(timestamp, 2),
        step: context.step || null,
        session: context.session || null,
        perception: {
          tracking_confidence: round(frame?.trackingConfidence),
          display_pose_source: frame?.displayPoseSource || null,
          motion_energy: round(frame?.motionEnergy),
          angles: compactAngles(frame?.angles),
          pose: compactLandmarks(frame?.filteredPose || frame?.pose),
          face_points: compactLandmarks(frame?.facePoints),
          hand_points: compactLandmarks(frame?.handPoints)
        },
        comparison: compactComposite(context.compositeForm),
        calculations: {
          difficulty: context.formDifficulty,
          mastery_threshold: context.masteryThreshold,
          targets: context.targets || []
        },
        rule_engine: sanitizePipelineValue(context.ruleEngineFrame || null, {
          maxArrayLength: 256,
          maxDepth: 10,
          maxObjectKeys: 160,
          maxStringLength: 2000
        }),
        practice: sanitizePipelineValue(context.practice || null, {
          maxArrayLength: 256,
          maxDepth: 10,
          maxObjectKeys: 160,
          maxStringLength: 2000
        }),
        layers: {
          level1: compactLayer(context.level1State, "motion_context"),
          level2: compactLayer(context.level2State, "action_context"),
          level3: compactLayer(context.level3State, "session_context"),
          level4: compactLayer(context.level4State, "user_context")
        },
        situation_awareness: situation,
        reasoning: situation?.reasoning || null,
        plan: situation?.next_action || null,
        action: situation?.feedback_decision || null,
        feedback: compactCoachEvent(context.coachEvent),
        voice: context.voice || null
      });
    },

    isActive: () => active,
    size: () => records.length,
    document: () => ({
      schema: "xmartialart-diagnostic-trace/v1",
      created_at: wallClock(),
      metadata,
      sampling: {
        interval_ms: sampleIntervalMs,
        pipeline_interval_ms: pipelineIntervalMs,
        max_records: maxRecords
      },
      records: [...records]
    }),
    filename: () => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      return `xmartialart-${safeFilenamePart(metadata.technique)}-${stamp}.json`;
    }
  };
}

async function createTraceBlob(document) {
  const payload = JSON.stringify(document);
  let blob = new Blob([payload], { type: "application/json" });
  let compressed = false;
  if (typeof CompressionStream === "function") {
    try {
      const compressedStream = blob.stream().pipeThrough(new CompressionStream("gzip"));
      blob = await new Response(compressedStream).blob();
      compressed = true;
    } catch {
      // Keep the compact JSON fallback when browser compression is unavailable.
    }
  }
  return { blob, compressed };
}

function createTraceBlobInWorker(document) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./diagnosticTraceExport.worker.js", import.meta.url),
      { type: "module" }
    );
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data?.error) {
        reject(new Error(event.data.error));
        return;
      }
      resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Diagnostic export worker failed"));
    };
    worker.postMessage(document);
  });
}

export async function downloadDiagnosticTrace(recorder) {
  const traceDocument = recorder.document();
  let exported;
  if (typeof Worker === "function") {
    try {
      exported = await createTraceBlobInWorker(traceDocument);
    } catch {
      exported = await createTraceBlob(traceDocument);
    }
  } else {
    exported = await createTraceBlob(traceDocument);
  }
  const { blob, compressed } = exported;
  const filename = `${recorder.filename()}${compressed ? ".gz" : ""}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
