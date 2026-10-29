from __future__ import annotations

import json
import os
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Any, Iterator

BACKEND_DIR = Path(__file__).resolve().parent
UPLOADS_DIR = BACKEND_DIR / "uploads"
OUTPUTS_DIR = BACKEND_DIR / "outputs"
MASKS_DIR = OUTPUTS_DIR / "masks"
EXPORTS_DIR = OUTPUTS_DIR / "exports"
DATASET_FILE = OUTPUTS_DIR / "dataset.json"
_DATASET_LOCK = RLock()


def ensure_directories() -> None:
    for directory in (UPLOADS_DIR, MASKS_DIR, EXPORTS_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def _write_dataset_unlocked(dataset: dict[str, Any]) -> None:
    ensure_directories()
    temporary_file = DATASET_FILE.with_suffix(".json.tmp")
    with temporary_file.open("w", encoding="utf-8") as dataset_file:
        json.dump(dataset, dataset_file, ensure_ascii=False, indent=2)
        dataset_file.flush()
        os.fsync(dataset_file.fileno())
    os.replace(temporary_file, DATASET_FILE)


def ensure_storage() -> None:
    ensure_directories()
    with _DATASET_LOCK:
        if not DATASET_FILE.exists():
            _write_dataset_unlocked({"schema_version": 1, "images": []})


def _read_dataset_unlocked() -> dict[str, Any]:
    ensure_storage()
    try:
        with DATASET_FILE.open("r", encoding="utf-8") as dataset_file:
            dataset = json.load(dataset_file)
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(
            "The local dataset JSON could not be read. Check backend/outputs/dataset.json."
        ) from exc

    if not isinstance(dataset, dict) or not isinstance(dataset.get("images"), list):
        raise RuntimeError(
            "The local dataset JSON has an invalid structure. Check backend/outputs/dataset.json."
        )
    return dataset


def read_dataset() -> dict[str, Any]:
    with _DATASET_LOCK:
        return _read_dataset_unlocked()


@contextmanager
def edit_dataset() -> Iterator[dict[str, Any]]:
    with _DATASET_LOCK:
        dataset = _read_dataset_unlocked()
        yield dataset
        _write_dataset_unlocked(dataset)


def resolve_backend_path(relative_path: str) -> Path:
    candidate = (BACKEND_DIR / relative_path).resolve()
    if not candidate.is_relative_to(BACKEND_DIR):
        raise ValueError("The stored file path is invalid.")
    return candidate


def remove_stored_files(paths: list[str | None]) -> None:
    for relative_path in paths:
        if not relative_path:
            continue
        try:
            resolve_backend_path(relative_path).unlink(missing_ok=True)
        except (OSError, ValueError):
            continue


ensure_storage()


__all__ = [
    "BACKEND_DIR",
    "DATASET_FILE",
    "EXPORTS_DIR",
    "MASKS_DIR",
    "OUTPUTS_DIR",
    "UPLOADS_DIR",
    "edit_dataset",
    "ensure_directories",
    "ensure_storage",
    "read_dataset",
    "remove_stored_files",
    "resolve_backend_path",
]


