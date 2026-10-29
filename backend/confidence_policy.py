from __future__ import annotations

import math
from typing import Any

MIN_ANNOTATION_CONFIDENCE = 0.30
DEFAULT_AUTO_ACCEPT_THRESHOLD = 0.90


def retained_confidence(value: Any) -> float | None:
    try:
        confidence = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    if not math.isfinite(confidence) or not MIN_ANNOTATION_CONFIDENCE <= confidence <= 1.0:
        return None
    return confidence


def normalize_auto_accept_threshold(value: Any) -> float | None:
    try:
        threshold = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    if not math.isfinite(threshold) or not MIN_ANNOTATION_CONFIDENCE <= threshold <= 1.0:
        return None
    return threshold


__all__ = [
    "DEFAULT_AUTO_ACCEPT_THRESHOLD",
    "MIN_ANNOTATION_CONFIDENCE",
    "normalize_auto_accept_threshold",
    "retained_confidence",
]
