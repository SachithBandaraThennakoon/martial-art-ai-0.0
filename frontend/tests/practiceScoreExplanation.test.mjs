import assert from "node:assert/strict";
import test from "node:test";

import { buildPracticeScoreExplanation } from "../src/utils/practiceScoreExplanation.js";

test("explains a low score with the failed joint and measured target", () => {
  const explanation = buildPracticeScoreExplanation({
    accuracy: 49,
    scorable: true,
    trackingReliable: true,
    focusBodyPart: "elbow_left",
    issue: "too_closed",
    wrongBodyParts: ["elbow_left"],
    angles: { elbow_left: 42 }
  }, {
    step: {
      angles: [{ body_part: "elbow_left", min: 70, max: 110 }]
    }
  });

  assert.equal(explanation.title, "Why this score is low");
  assert.match(explanation.summary, /Elbow Left.*closed/i);
  assert.ok(explanation.details.some((detail) => /42°.*70–110°/.test(detail)));
  assert.ok(explanation.details.some((detail) => /critical joint/i.test(detail)));
});

test("explains why an unscored transition has no accuracy", () => {
  const explanation = buildPracticeScoreExplanation({
    accuracy: null,
    scorable: false,
    trackingReliable: true
  });

  assert.equal(explanation.tone, "transition");
  assert.match(explanation.summary, /transition|preparation/i);
});
