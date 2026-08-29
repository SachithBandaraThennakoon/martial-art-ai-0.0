import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCoachSessionConfigPacket,
  buildCoachTrainingFramePacket
} from "../src/services/coachWebSocketPackets.js";

test("static target definitions are sent once with step configuration", () => {
  const targets = [{ body_part: "elbow_left", target_angle: 150 }];
  const packet = buildCoachSessionConfigPacket({
    sessionConfig: { technique_name: "Jab", mode: "train" },
    stepKey: "extend",
    stepName: "Extend lead hand",
    requiredParts: targets
  });

  assert.equal(packet.type, "session_config");
  assert.equal(packet.step_key, "extend");
  assert.deepEqual(packet.required_parts, targets);
});

test("high-frequency training frames contain only changing movement data", () => {
  const packet = buildCoachTrainingFramePacket({
    stepId: "extend",
    stepName: "Extend lead hand",
    angles: { elbow_left: 149 }
  });

  assert.deepEqual(packet, {
    type: "training_frame",
    step_id: "extend",
    step_name: "Extend lead hand",
    angles: { elbow_left: 149 }
  });
  assert.equal("required_parts" in packet, false);
  assert.equal("angle_targets" in packet, false);
  assert.equal("feedback_targets" in packet, false);
});
