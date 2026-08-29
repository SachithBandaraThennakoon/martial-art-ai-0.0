import assert from "node:assert/strict";
import test from "node:test";

import { selectExpectedVoiceCommand } from "../src/services/voiceCommandRecognition.js";

const nextOptions = [
  { label: "Next step", value: "next step" },
  { label: "Repeat step", value: "no, repeat step" },
  { label: "Wait", value: "wait" }
];

test("recognition chooses a matching command from non-primary alternatives", () => {
  const selected = selectExpectedVoiceCommand([
    { transcript: "neck stamp", confidence: 0.7 },
    { transcript: "next step", confidence: 0.62 }
  ], nextOptions);

  assert.equal(selected.command, "next step");
});

test("question vocabulary safely resolves common command mishearings", () => {
  assert.equal(
    selectExpectedVoiceCommand([{ transcript: "neck step", confidence: 0.55 }], nextOptions).command,
    "next step"
  );
  assert.equal(
    selectExpectedVoiceCommand([{ transcript: "same step", confidence: 0.6 }], nextOptions).command,
    "no, repeat step"
  );
});

test("next-step context accepts the mishearings observed in diagnostic traces", () => {
  const options = [
    { label: "Next step", value: "next step" },
    { label: "Repeat step", value: "no, repeat step" },
    { label: "Wait", value: "wait" }
  ];

  assert.equal(
    selectExpectedVoiceCommand([{ transcript: "Existed.", confidence: 1 }], options)?.command,
    "next step"
  );
  assert.equal(
    selectExpectedVoiceCommand([{ transcript: "And existed.", confidence: 1 }], options)?.command,
    "next step"
  );
  assert.equal(
    selectExpectedVoiceCommand([{ transcript: "This step.", confidence: 0.8 }], options)?.command,
    "next step"
  );
  assert.equal(
    selectExpectedVoiceCommand([{ transcript: "This is tip.", confidence: 0.8 }], options)?.command,
    "next step"
  );
});

test("unrelated speech is not accepted as a pending-question answer", () => {
  assert.equal(
    selectExpectedVoiceCommand([{ transcript: "the phone is ringing", confidence: 0.9 }], nextOptions),
    null
  );
});
