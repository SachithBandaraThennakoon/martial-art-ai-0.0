import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPracticeAnalysisTrace,
  practiceAnalysisTraceFilename
} from "../src/services/practiceAnalysisExport.js";

test("admin analysis trace combines session metadata with its stored frame tape", () => {
  const session = {
    id: 42,
    technique_name: "Lead Jab",
    analytics: { tracking_quality_percentage: 91 }
  };
  const tape = {
    schema_name: "practice-tape/v2",
    frames: [{ t: 100, p: [[1000, 2000, 0, 9000]] }]
  };

  const trace = buildPracticeAnalysisTrace({ session, tape });

  assert.equal(trace.schema, "xmartialart-practice-analysis-trace/v1");
  assert.equal(trace.source, "admin-studio-analysis");
  assert.equal(trace.session, session);
  assert.equal(trace.tape, tape);
  assert.equal(trace.privacy.contains_video, false);
  assert.equal(trace.privacy.contains_pose_landmarks, true);
  assert.equal(trace.diagnostic_data.tape_status, "available");
  assert.equal(trace.diagnostic_data.frame_count, 1);
  assert.match(trace.exported_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    practiceAnalysisTraceFilename(session),
    "lead-jab-session-42-analysis.json"
  );
});

test("analysis JSON remains useful when no frame tape was stored", () => {
  const session = { id: 7, technique_name: "Jab", completed_reps: 3 };
  const trace = buildPracticeAnalysisTrace({
    session,
    tape: null,
    tapeStatus: "not-stored"
  });

  assert.equal(trace.session, session);
  assert.equal(trace.tape, null);
  assert.equal(trace.diagnostic_data.tape_status, "not-stored");
  assert.equal(trace.diagnostic_data.frame_count, 0);
  assert.equal(trace.privacy.contains_pose_landmarks, false);
});
