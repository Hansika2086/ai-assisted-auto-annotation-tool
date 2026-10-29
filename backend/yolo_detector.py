
from __future__ import annotations

import os
from pathlib import Path
from threading import RLock
from typing import Any

from .confidence_policy import MIN_ANNOTATION_CONFIDENCE

YOLO_MODEL_NAME = os.environ.get("YOLO_MODEL", "yoloe-26n-seg.pt")

_DETECTION_FLOOR = MIN_ANNOTATION_CONFIDENCE
_MAX_DETECTIONS = int(os.environ.get("YOLO_MAX_DETECTIONS", "300"))

_MODEL: Any | None = None
_MODEL_LOCK = RLock()


def _load_model() -> Any:
    global _MODEL

    with _MODEL_LOCK:
        if _MODEL is None:
            try:
                from ultralytics import YOLOE
            except ImportError as exc:
                raise RuntimeError(
                    "YOLOE is unavailable. Update the ultralytics package."
                ) from exc

            _MODEL = YOLOE(YOLO_MODEL_NAME)

    return _MODEL


def get_class_map() -> dict[str, int]:
    model = _load_model()
    names = model.names

    if isinstance(names, dict):
        entries = names.items()
    else:
        entries = enumerate(names)

    return {
        str(name): int(class_id)
        for class_id, name in entries
    }


def detect_objects(
    image_path: Path,
    object_names: list[str],
) -> list[dict[str, Any]]:
    if not object_names:
        return []

    model = _load_model()

    with _MODEL_LOCK:
        model.set_classes(object_names)

        results = model.predict(
            source=str(image_path),
            conf=_DETECTION_FLOOR,
            iou=0.75,
            imgsz=960,
            max_det=_MAX_DETECTIONS,
            verbose=False,
        )

    detections: list[dict[str, Any]] = []

    for result in results:
        boxes = result.boxes

        if boxes is None:
            continue

        names = result.names

        for index in range(len(boxes)):
            class_id = int(boxes.cls[index].item())
            bbox = boxes.xyxy[index].detach().cpu().tolist()
            confidence = float(boxes.conf[index].item())

            if isinstance(names, dict):
                object_name = names.get(class_id, str(class_id))
            else:
                object_name = names[class_id]

            detections.append({
                "class_id": class_id,
                "object": str(object_name),
                "confidence": confidence,
                "bbox": [float(value) for value in bbox],
            })

    return detections


def model_status() -> dict[str, str | bool]:
    return {
        "name": YOLO_MODEL_NAME,
        "loaded": _MODEL is not None,
    }


__all__ = [
    "YOLO_MODEL_NAME",
    "detect_objects",
    "get_class_map",
    "model_status",
]
