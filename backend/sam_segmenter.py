from __future__ import annotations

import os
from pathlib import Path
from threading import RLock
from typing import Any

import cv2
import numpy as np

SAM_MODEL_NAME = os.environ.get("SAM_MODEL", "mobile_sam.pt")
_SAM_PREDICTOR: Any | None = None
_SAM_LOCK = RLock()


def _load_predictor() -> Any:
    global _SAM_PREDICTOR
    if _SAM_PREDICTOR is None:
        try:
            from ultralytics.models.sam import Predictor as SAMPredictor
        except ImportError as exc:
            raise RuntimeError(
                "Ultralytics SAM is unavailable. Install backend/requirements.txt first."
            ) from exc
        _SAM_PREDICTOR = SAMPredictor(
            overrides={
                "conf": 0.25,
                "task": "segment",
                "mode": "predict",
                "imgsz": 1024,
                "model": SAM_MODEL_NAME,
                "verbose": False,
            }
        )
    return _SAM_PREDICTOR


def _best_mask(result: Any, expected_shape: tuple[int, int]) -> np.ndarray:
    if result.masks is None or result.masks.data is None or len(result.masks.data) == 0:
        raise RuntimeError("SAM did not return a mask for a YOLO detection.")

    mask_data = result.masks.data
    mask_index = 0
    if result.boxes is not None and len(result.boxes.conf) == len(mask_data):
        mask_index = int(result.boxes.conf.argmax().item())

    mask = mask_data[mask_index].detach().cpu().numpy()
    if mask.ndim != 2:
        raise RuntimeError("SAM returned a mask with an unsupported shape.")

    height, width = expected_shape
    binary_mask = (mask > 0.5).astype(np.uint8)
    if binary_mask.shape != (height, width):
        binary_mask = cv2.resize(
            binary_mask,
            (width, height),
            interpolation=cv2.INTER_NEAREST,
        )
    if not np.any(binary_mask):
        raise RuntimeError("SAM returned an empty mask for a YOLO detection.")
    return binary_mask


def segment_boxes(
    image_path: Path,
    bounding_boxes: list[list[float]],
    expected_shape: tuple[int, int],
) -> list[np.ndarray]:
    if not bounding_boxes:
        return []

    with _SAM_LOCK:
        predictor = _load_predictor()
        predictor.set_image(str(image_path))
        try:
            masks: list[np.ndarray] = []
            for bbox in bounding_boxes:
                result_set = predictor(
                    bboxes=[float(value) for value in bbox],
                    verbose=False,
                )
                if not result_set:
                    raise RuntimeError("SAM returned no result for a YOLO bounding box.")
                masks.append(_best_mask(result_set[0], expected_shape))
            return masks
        finally:
            predictor.reset_image()


def model_status() -> dict[str, str | bool]:
    return {"name": SAM_MODEL_NAME, "loaded": _SAM_PREDICTOR is not None}


__all__ = ["SAM_MODEL_NAME", "model_status", "segment_boxes"]


