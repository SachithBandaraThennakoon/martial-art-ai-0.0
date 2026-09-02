import json
import sys
from pathlib import Path

import cv2
import numpy as np


VIDEO = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\sachi\Downloads\jab-session-76.webm"
)
OUTPUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).parent
OUTPUT.mkdir(parents=True, exist_ok=True)


capture = cv2.VideoCapture(str(VIDEO))
if not capture.isOpened():
    raise RuntimeError(f"Unable to open {VIDEO}")

samples = []
dense_samples = []
motion = []
frame_count = 0
last_sample_ms = -1000.0
last_dense_sample_ms = -250.0
last_gray = None
last_timestamp_ms = 0.0

while True:
    ok, frame = capture.read()
    if not ok:
        break
    frame_count += 1
    timestamp_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC))
    last_timestamp_ms = max(last_timestamp_ms, timestamp_ms)

    gray = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (160, 120))
    if last_gray is not None:
        motion.append((timestamp_ms, float(cv2.absdiff(gray, last_gray).mean())))
    last_gray = gray

    if timestamp_ms - last_sample_ms >= 1000:
        samples.append((timestamp_ms, frame.copy()))
        last_sample_ms = timestamp_ms
    if timestamp_ms - last_dense_sample_ms >= 250:
        dense_samples.append((timestamp_ms, frame.copy()))
        last_dense_sample_ms = timestamp_ms

capture.release()

thumb_w, thumb_h = 320, 240
for sheet_index in range(0, len(samples), 12):
    page = samples[sheet_index : sheet_index + 12]
    sheet = np.zeros((thumb_h * 3, thumb_w * 4, 3), dtype=np.uint8)
    for cell, (timestamp_ms, frame) in enumerate(page):
        thumb = cv2.resize(frame, (thumb_w, thumb_h))
        cv2.rectangle(thumb, (0, 0), (125, 28), (0, 0, 0), -1)
        cv2.putText(
            thumb,
            f"{timestamp_ms / 1000:.1f}s",
            (8, 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
        row, col = divmod(cell, 4)
        sheet[row * thumb_h : (row + 1) * thumb_h, col * thumb_w : (col + 1) * thumb_w] = thumb
    cv2.imwrite(str(OUTPUT / f"contact_{sheet_index // 12 + 1:02d}.jpg"), sheet)

dense_w, dense_h = 256, 192
for sheet_index in range(0, len(dense_samples), 20):
    page = dense_samples[sheet_index : sheet_index + 20]
    sheet = np.zeros((dense_h * 4, dense_w * 5, 3), dtype=np.uint8)
    for cell, (timestamp_ms, frame) in enumerate(page):
        thumb = cv2.resize(frame, (dense_w, dense_h))
        cv2.rectangle(thumb, (0, 0), (100, 24), (0, 0, 0), -1)
        cv2.putText(
            thumb,
            f"{timestamp_ms / 1000:.2f}s",
            (6, 17),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
        row, col = divmod(cell, 5)
        sheet[row * dense_h : (row + 1) * dense_h, col * dense_w : (col + 1) * dense_w] = thumb
    cv2.imwrite(str(OUTPUT / f"dense_{sheet_index // 20 + 1:02d}.jpg"), sheet)

top_motion = sorted(motion, key=lambda item: item[1], reverse=True)[:30]
summary = {
    "decoded_frames": frame_count,
    "last_timestamp_ms": round(last_timestamp_ms, 3),
    "sample_count": len(samples),
    "dense_sample_count": len(dense_samples),
    "top_motion": [
        {"timestamp_ms": round(timestamp_ms, 3), "mean_absdiff": round(score, 3)}
        for timestamp_ms, score in top_motion
    ],
}
print(json.dumps(summary, indent=2))
