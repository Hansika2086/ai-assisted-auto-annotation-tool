from __future__ import annotations

import hashlib
import math
import re
import uuid
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any

import cv2
import numpy as np

from .confidence_policy import (
    DEFAULT_AUTO_ACCEPT_THRESHOLD,
    normalize_auto_accept_threshold,
    retained_confidence,
)
from .sam_segmenter import SAM_MODEL_NAME, segment_boxes
from .storage import (
    BACKEND_DIR,
    MASKS_DIR,
    UPLOADS_DIR,
    edit_dataset,
    read_dataset,
    remove_stored_files,
    resolve_backend_path,
)
from .yolo_detector import YOLO_MODEL_NAME, detect_objects

SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}
MAX_IMAGE_BYTES = 30 * 1024 * 1024
MAX_ZIP_BYTES = 100 * 1024 * 1024
MAX_TOTAL_UPLOAD_BYTES = 200 * 1024 * 1024
MAX_ZIP_IMAGE_BYTES = 250 * 1024 * 1024
MAX_ZIP_ENTRIES = 500
MAX_IMAGES_PER_REQUEST = 100
MAX_IMAGE_PIXELS = 75_000_000


class RequestValidationError(ValueError):
    pass


class UnsupportedObjectError(ValueError):
    def __init__(self, unsupported_objects: list[str], supported_classes: list[str]):
        super().__init__("Object is not supported by current YOLO model.")
        self.unsupported_objects = unsupported_objects
        self.supported_classes = supported_classes


class ModelServiceError(RuntimeError):
    pass


def _safe_display_name(filename: str) -> str:
    normalized = filename.replace("\\", "/")
    basename = PurePosixPath(normalized).name
    cleaned = "".join(character for character in basename if character.isprintable()).strip()
    return cleaned[:160] or "image"


def _read_zip_member(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    if info.file_size > MAX_IMAGE_BYTES:
        raise RequestValidationError(f"{info.filename} exceeds the 30 MB per-image limit.")
    with archive.open(info, "r") as member:
        data = member.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise RequestValidationError(f"{info.filename} exceeds the 30 MB per-image limit.")
    return data


def _expand_uploads(uploads: list[tuple[str, bytes]]) -> list[tuple[str, bytes]]:
    if sum(len(data) for _, data in uploads) > MAX_TOTAL_UPLOAD_BYTES:
        raise RequestValidationError("The combined upload size must be 200 MB or smaller.")

    image_entries: list[tuple[str, bytes]] = []
    total_uncompressed_bytes = 0

    for filename, data in uploads:
        display_name = _safe_display_name(filename)
        suffix = Path(display_name).suffix.lower()
        if suffix in SUPPORTED_IMAGE_SUFFIXES:
            if len(data) > MAX_IMAGE_BYTES:
                raise RequestValidationError(f"{display_name} exceeds the 30 MB per-image limit.")
            image_entries.append((display_name, data))
        elif suffix == ".zip":
            if len(data) > MAX_ZIP_BYTES:
                raise RequestValidationError("Each ZIP file must be 100 MB or smaller.")
            try:
                with zipfile.ZipFile(BytesIO(data)) as archive:
                    entries = archive.infolist()
                    if len(entries) > MAX_ZIP_ENTRIES:
                        raise RequestValidationError("A ZIP file may contain at most 500 entries.")
                    for info in entries:
                        if info.is_dir():
                            continue
                        member_name = _safe_display_name(info.filename)
                        if Path(member_name).suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
                            continue
                        total_uncompressed_bytes += info.file_size
                        if total_uncompressed_bytes > MAX_ZIP_IMAGE_BYTES:
                            raise RequestValidationError(
                                "Extracted images in a ZIP file may total at most 250 MB."
                            )
                        image_entries.append((member_name, _read_zip_member(archive, info)))
            except zipfile.BadZipFile as exc:
                raise RequestValidationError(f"{display_name} is not a valid ZIP file.") from exc
        else:
            raise RequestValidationError(
                f"{display_name} is not a supported image or ZIP. Use JPG, JPEG, PNG, or ZIP."
            )

        if len(image_entries) > MAX_IMAGES_PER_REQUEST:
            raise RequestValidationError(
                f"A single annotation run may contain at most {MAX_IMAGES_PER_REQUEST} images."
            )

    if not image_entries:
        raise RequestValidationError("The selected ZIP file contains no JPG, JPEG, or PNG images.")
    return image_entries


def _parse_objects(raw_objects: str) -> list[str]:
    requested = [part.strip() for part in re.split(r"[,;\n]+", raw_objects) if part.strip()]
    unique: list[str] = []
    seen: set[str] = set()
    for item in requested:
        key = " ".join(item.casefold().split())
        if key not in seen:
            seen.add(key)
            unique.append(item)
    if not unique:
        raise RequestValidationError("Enter at least one object to detect.")
    if len(unique) > 20:
        raise RequestValidationError("Enter no more than 20 object names per annotation run.")
    return unique


def _normalize_class_name(name: str) -> str:
    return " ".join(name.casefold().replace("_", " ").split())


def _resolve_requested_objects(
    requested_objects: list[str], class_map: dict[str, int]
) -> tuple[list[str], list[int], list[str]]:
    normalized_classes = {_normalize_class_name(name): (name, class_id) for name, class_id in class_map.items()}
    resolved_names: list[str] = []
    resolved_ids: list[int] = []
    unsupported: list[str] = []

    for requested in requested_objects:
        normalized = _normalize_class_name(requested)
        candidates = [normalized]
        if normalized.endswith("ies") and len(normalized) > 3:
            candidates.append(f"{normalized[:-3]}y")
        elif normalized.endswith("es") and len(normalized) > 2:
            candidates.append(normalized[:-2])
        elif normalized.endswith("s") and len(normalized) > 1:
            candidates.append(normalized[:-1])

        match = next((normalized_classes[candidate] for candidate in candidates if candidate in normalized_classes), None)
        if match is None:
            unsupported.append(requested)
            continue
        name, class_id = match
        if class_id not in resolved_ids:
            resolved_names.append(name)
            resolved_ids.append(class_id)

    return resolved_names, resolved_ids, unsupported


def _decode_dimensions(data: bytes, filename: str) -> tuple[int, int]:
    encoded = np.frombuffer(data, dtype=np.uint8)
    try:
        image = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    except cv2.error as exc:
        raise RequestValidationError(f"{filename} could not be decoded as a valid image.") from exc
    if image is None:
        raise RequestValidationError(f"{filename} could not be decoded as a valid image.")
    height, width = image.shape[:2]
    if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
        raise RequestValidationError(f"{filename} has unsupported image dimensions.")
    return int(width), int(height)


def _relative_to_backend(path: Path) -> str:
    return path.resolve().relative_to(BACKEND_DIR).as_posix()


def save_mask_artifacts(
    image_id: str,
    annotation_id: str,
    mask: np.ndarray,
) -> tuple[str, str]:
    binary = (mask > 0).astype(np.uint8) * 255
    if binary.ndim != 2 or not np.any(binary):
        raise ModelServiceError("SAM produced an empty segmentation mask.")

    artifact_id = uuid.uuid4().hex
    mask_path = MASKS_DIR / f"{image_id}_{annotation_id}_{artifact_id}.png"
    overlay_path = MASKS_DIR / f"{image_id}_{annotation_id}_{artifact_id}_overlay.png"

    rgba_overlay = np.zeros((binary.shape[0], binary.shape[1], 4), dtype=np.uint8)
    rgba_overlay[binary > 0] = (206, 151, 255, 112)
    try:
        if not cv2.imwrite(str(mask_path), binary) or not cv2.imwrite(str(overlay_path), rgba_overlay):
            raise ModelServiceError("The segmentation mask could not be saved to local storage.")
    except Exception:
        mask_path.unlink(missing_ok=True)
        overlay_path.unlink(missing_ok=True)
        raise
    return _relative_to_backend(mask_path), _relative_to_backend(overlay_path)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_manual_annotation(annotation: dict[str, Any]) -> bool:
    return (
        annotation.get("source") == "manual"
        or annotation.get("status") == "human_annotated"
    )


def _is_visible_annotation(annotation: dict[str, Any]) -> bool:
    return is_manual_annotation(annotation) or retained_confidence(annotation.get("confidence")) is not None


def summarize_images(images: list[dict[str, Any]]) -> dict[str, int]:
    annotations = [
        annotation
        for image in images
        for annotation in image.get("annotations", [])
        if _is_visible_annotation(annotation)
    ]
    return {
        "total_images": len(images),
        "total_detected_objects": len(annotations),
        "auto_accepted_annotations": sum(
            annotation.get("status") == "auto_accepted" for annotation in annotations
        ),
        "human_reviewed_annotations": sum(bool(annotation.get("reviewed")) for annotation in annotations),
        "rejected_annotations": sum(annotation.get("status") == "rejected" for annotation in annotations),
        "final_accepted_annotations": sum(
            annotation.get("status") in {"auto_accepted", "accepted", "human_annotated"}
            for annotation in annotations
        ),
    }


def _box_iou(first: Any, second: Any) -> float:
    if not isinstance(first, (list, tuple)) or len(first) != 4:
        return 0.0
    if not isinstance(second, (list, tuple)) or len(second) != 4:
        return 0.0

    try:
        ax1, ay1, ax2, ay2 = (float(value) for value in first)
        bx1, by1, bx2, by2 = (float(value) for value in second)
    except (TypeError, ValueError, OverflowError):
        return 0.0

    if not all(math.isfinite(value) for value in (ax1, ay1, ax2, ay2, bx1, by1, bx2, by2)):
        return 0.0

    intersection_width = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    intersection_height = max(0.0, min(ay2, by2) - max(ay1, by1))
    intersection = intersection_width * intersection_height
    first_area = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    second_area = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


def _matches_rejected_feedback(
    detection: dict[str, Any],
    image_hash: str,
    dataset: dict[str, Any],
) -> bool:
    for image in dataset.get("images", []):
        if not isinstance(image, dict):
            continue

        stored_hash = image.get("image_hash")
        annotations = image.get("annotations", [])
        rejected_annotations = [
            annotation
            for annotation in annotations
            if isinstance(annotation, dict) and annotation.get("status") == "rejected"
        ] if isinstance(annotations, list) else []

        if not stored_hash and rejected_annotations:
            try:
                image_path = resolve_backend_path(str(image.get("stored_path", "")))
                if image_path.is_file():
                    stored_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
            except (OSError, ValueError):
                stored_hash = None
        if stored_hash != image_hash:
            continue

        feedback_entries = image.get("rejected_feedback", [])
        if not isinstance(feedback_entries, list):
            feedback_entries = []
        feedback_entries = [*feedback_entries, *rejected_annotations]

        for entry in feedback_entries:
            if not isinstance(entry, dict):
                continue
            try:
                same_class = int(entry.get("class_id")) == int(detection["class_id"])
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            if same_class and _box_iou(detection.get("bbox"), entry.get("bbox")) >= 0.5:
                return True
    return False


def public_image(image: dict[str, Any]) -> dict[str, Any]:
    image_id = image["id"]
    public_annotations = []
    for annotation in image.get("annotations", []):
        if not _is_visible_annotation(annotation):
            continue
        has_mask = bool(annotation.get("mask_overlay_path"))
        public_annotations.append(
            {
                "id": annotation["id"],
                "class_id": annotation.get("class_id"),
                "object": annotation["object"],
                "confidence": annotation.get("confidence"),
                "bbox": annotation["bbox"],
                "status": annotation["status"],
                "reviewed": bool(annotation.get("reviewed")),
                "reviewed_at": annotation.get("reviewed_at"),
                "review_action": annotation.get("review_action"),
                "source": annotation.get("source", "yolo"),
                "mask_url": f"/api/images/{image_id}/annotations/{annotation['id']}/mask" if has_mask else None,
            }
        )

    return {
        "id": image_id,
        "filename": image["filename"],
        "width": image["width"],
        "height": image["height"],
        "file_size": image["file_size"],
        "created_at": image["created_at"],
        "requested_objects": image["requested_objects"],
        "image_url": f"/api/images/{image_id}/file",
        "annotations": public_annotations,
    }


def dataset_payload(dataset: dict[str, Any] | None = None) -> dict[str, Any]:
    stored_dataset = dataset if dataset is not None else read_dataset()
    images = stored_dataset.get("images", [])
    return {
        "images": [public_image(image) for image in images],
        "summary": summarize_images(images),
    }


def _validate_corrected_bbox(bbox: list[float], width: int, height: int) -> list[float]:
    if len(bbox) != 4 or not all(math.isfinite(value) for value in bbox):
        raise RequestValidationError("A corrected bounding box must contain four finite coordinates.")
    x1, y1, x2, y2 = [float(value) for value in bbox]
    if x1 < 0 or y1 < 0 or x2 > width or y2 > height or x2 <= x1 or y2 <= y1:
        raise RequestValidationError(
            f"The corrected box must fit inside the image (0–{width} by 0–{height})."
        )
    return [x1, y1, x2, y2]


def _record_rejected_feedback(
    image: dict[str, Any],
    annotation: dict[str, Any],
    reviewed_at: str,
) -> None:
    image_hash = image.get("image_hash")
    if not isinstance(image_hash, str) or not image_hash:
        try:
            image_path = resolve_backend_path(str(image.get("stored_path", "")))
            if image_path.is_file():
                image_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
                image["image_hash"] = image_hash
        except (OSError, ValueError):
            image_hash = None

    feedback_entries = image.get("rejected_feedback")
    if not isinstance(feedback_entries, list):
        feedback_entries = []
        image["rejected_feedback"] = feedback_entries

    entry = {
        "class_id": int(annotation["class_id"]),
        "bbox": [float(value) for value in annotation["bbox"]],
        "rejected_at": reviewed_at,
    }
    for existing in feedback_entries:
        if not isinstance(existing, dict):
            continue
        try:
            same_class = int(existing.get("class_id", -1)) == entry["class_id"]
        except (TypeError, ValueError, OverflowError):
            continue
        if same_class and _box_iou(existing.get("bbox"), entry["bbox"]) >= 0.5:
            return
    feedback_entries.append(entry)



def annotate_uploads(
    uploads: list[tuple[str, bytes]],
    raw_objects: str,
    auto_accept_threshold: float = DEFAULT_AUTO_ACCEPT_THRESHOLD,
) -> dict[str, Any]:
    normalized_threshold = normalize_auto_accept_threshold(auto_accept_threshold)
    if normalized_threshold is None:
        raise RequestValidationError("Enter a valid confidence review threshold.")

    requested_objects = _parse_objects(raw_objects)
    image_entries = _expand_uploads(uploads)

    rejected_feedback_dataset = read_dataset()
    created_records: list[dict[str, Any]] = []
    created_file_paths: list[str] = []
    new_detection_count = 0

    try:
        for filename, file_bytes in image_entries:
            width, height = _decode_dimensions(file_bytes, filename)
            image_hash = hashlib.sha256(file_bytes).hexdigest()
            image_id = str(uuid.uuid4())
            suffix = Path(filename).suffix.lower()
            stored_filename = f"{image_id}{suffix}"
            stored_path = UPLOADS_DIR / stored_filename
            stored_path.write_bytes(file_bytes)

            relative_image_path = _relative_to_backend(stored_path)
            created_file_paths.append(relative_image_path)

            try:
                detections = detect_objects(stored_path, requested_objects)
            except Exception as exc:
                raise ModelServiceError(
                    f"YOLOE inference failed for {filename}. "
                    "Check the model weights and backend installation."
                ) from exc

            eligible_detections: list[tuple[dict[str, Any], float]] = []

            for detection in detections:
                confidence = retained_confidence(detection.get("confidence"))
                if confidence is None:
                    continue

                if _matches_rejected_feedback(
                    detection,
                    image_hash,
                    rejected_feedback_dataset,
                ):
                    continue

                eligible_detections.append((detection, confidence))

            if eligible_detections:
                try:
                    masks = segment_boxes(
                        stored_path,
                        [
                            detection["bbox"]
                            for detection, _ in eligible_detections
                        ],
                        (height, width),
                    )
                except Exception as exc:
                    raise ModelServiceError(
                        f"SAM segmentation failed for {filename}. "
                        "Check the SAM model weights and try again."
                    ) from exc
            else:
                masks = []

            if len(masks) != len(eligible_detections):
                raise ModelServiceError(
                    f"SAM returned an unexpected number of masks for {filename}."
                )

            annotations: list[dict[str, Any]] = []

            for (detection, confidence), mask in zip(
                eligible_detections, masks, strict=True
            ):
                annotation_id = str(uuid.uuid4())

                mask_path, overlay_path = save_mask_artifacts(
                    image_id,
                    annotation_id,
                    mask,
                )
                created_file_paths.extend((mask_path, overlay_path))

                annotations.append(
                    {
                        "id": annotation_id,
                        "class_id": int(detection["class_id"]),
                        "object": str(detection["object"]),
                        "confidence": confidence,
                        "bbox": [
                            float(value) for value in detection["bbox"]
                        ],
                        "status": (
                            "auto_accepted"
                            if confidence >= normalized_threshold
                            else "needs_review"
                        ),
                        "reviewed": False,
                        "reviewed_at": None,
                        "review_action": None,
                        "source": "yolo",
                        "mask_path": mask_path,
                        "mask_overlay_path": overlay_path,
                    }
                )

            new_detection_count += len(annotations)

            created_records.append(
                {
                    "id": image_id,
                    "filename": filename,
                    "stored_path": relative_image_path,
                    "width": width,
                    "height": height,
                    "file_size": len(file_bytes),
                    "created_at": _now_iso(),
                    "image_hash": image_hash,
                    "requested_objects": requested_objects,
                    "annotations": annotations,
                }
            )

        with edit_dataset() as dataset:
            dataset.setdefault("schema_version", 1)
            dataset.setdefault("images", []).extend(created_records)

    except Exception:
        remove_stored_files(created_file_paths)
        raise

    updated_dataset = read_dataset()
    payload = dataset_payload(updated_dataset)
    new_public_images = [
        public_image(image) for image in created_records
    ]

    return {
        "images": new_public_images,
        "dataset": payload,
        "summary": payload["summary"],
        "message": (
            "No matching objects were detected."
            if new_detection_count == 0
            else None
        ),
    }

def create_manual_annotation(
    image_id: str,
    label: str,
    bbox: list[float],
) -> dict[str, Any]:
    normalized_label = " ".join(label.split())
    if not normalized_label:
        raise RequestValidationError("Enter an object name for the manual annotation.")
    if len(normalized_label) > 80:
        raise RequestValidationError("Object names may contain at most 80 characters.")

    annotation_id = str(uuid.uuid4())
    with edit_dataset() as dataset:
        image = next((item for item in dataset["images"] if item["id"] == image_id), None)
        if image is None:
            raise KeyError("Image not found.")
        validated_bbox = _validate_corrected_bbox(
            bbox,
            int(image["width"]),
            int(image["height"]),
        )
        image.setdefault("annotations", []).append(
            {
                "id": annotation_id,
                "class_id": None,
                "object": normalized_label,
                "confidence": None,
                "bbox": validated_bbox,
                "status": "human_annotated",
                "reviewed": False,
                "reviewed_at": None,
                "review_action": None,
                "source": "manual",
                "mask_path": None,
                "mask_overlay_path": None,
            }
        )

    return {**dataset_payload(read_dataset()), "annotation_id": annotation_id}


def review_annotation(
    image_id: str,
    annotation_id: str,
    action: str,
    label: str | None = None,
    bbox: list[float] | None = None,
) -> dict[str, Any]:
    dataset = read_dataset()
    image = next((item for item in dataset["images"] if item["id"] == image_id), None)
    if image is None:
        raise KeyError("Image not found.")
    annotation = next(
        (item for item in image.get("annotations", []) if item["id"] == annotation_id),
        None,
    )
    if annotation is None or retained_confidence(annotation.get("confidence")) is None:
        raise KeyError("Annotation not found.")
    if action not in {"accept", "reject", "edit"}:
        raise RequestValidationError("Review action must be accept, reject, or edit.")

    new_mask_path: str | None = None
    new_overlay_path: str | None = None
    old_mask_paths: list[str | None] = []
    corrected_bbox: list[float] | None = None
    corrected_label: str | None = None

    if action == "edit":
        corrected_label = (label or "").strip()
        if not corrected_label:
            raise RequestValidationError("Enter a corrected object name.")
        if len(corrected_label) > 80:
            raise RequestValidationError("Corrected object names may contain at most 80 characters.")
        if bbox is None:
            raise RequestValidationError("A corrected bounding box is required.")
        corrected_bbox = _validate_corrected_bbox(bbox, int(image["width"]), int(image["height"]))
        image_path = resolve_backend_path(image["stored_path"])
        if not image_path.is_file():
            raise ModelServiceError("The uploaded image is missing from local storage.")
        try:
            corrected_masks = segment_boxes(
                image_path,
                [corrected_bbox],
                (int(image["height"]), int(image["width"])),
            )
        except Exception as exc:
            raise ModelServiceError(
                f"SAM could not regenerate the mask for the corrected box. Check the SAM model weights."
            ) from exc
        try:
            new_mask_path, new_overlay_path = save_mask_artifacts(
                image_id,
                annotation_id,
                corrected_masks[0],
            )
        except Exception:
            remove_stored_files([new_mask_path, new_overlay_path])
            raise
        old_mask_paths = [annotation.get("mask_path"), annotation.get("mask_overlay_path")]

    try:
        with edit_dataset() as editable_dataset:
            editable_image = next(
                (item for item in editable_dataset["images"] if item["id"] == image_id),
                None,
            )
            if editable_image is None:
                raise KeyError("Image not found.")
            editable_annotation = next(
                (item for item in editable_image.get("annotations", []) if item["id"] == annotation_id),
                None,
            )
            if editable_annotation is None:
                raise KeyError("Annotation not found.")

            now = _now_iso()
            if action == "reject":
                editable_annotation["status"] = "rejected"
                _record_rejected_feedback(editable_image, editable_annotation, now)
            elif action == "accept":
                editable_annotation["status"] = "accepted"
            else:
                editable_annotation["object"] = corrected_label
                editable_annotation["bbox"] = corrected_bbox
                editable_annotation["mask_path"] = new_mask_path
                editable_annotation["mask_overlay_path"] = new_overlay_path
                editable_annotation["source"] = "human_corrected"
                editable_annotation["status"] = "accepted"
            editable_annotation["reviewed"] = True
            editable_annotation["reviewed_at"] = now
            editable_annotation["review_action"] = action
    except Exception:
        remove_stored_files([new_mask_path, new_overlay_path])
        raise

    if old_mask_paths:
        remove_stored_files(old_mask_paths)
    return dataset_payload(read_dataset())

def stored_image_record(image_id: str) -> dict[str, Any] | None:
    dataset = read_dataset()
    return next(
        (image for image in dataset["images"] if image["id"] == image_id),
        None,
    )
def reannotate_stored_image(
    image_id: str,
    raw_objects: str,
    auto_accept_threshold: float = DEFAULT_AUTO_ACCEPT_THRESHOLD,
) -> dict[str, Any]:
    threshold = normalize_auto_accept_threshold(auto_accept_threshold)
    if threshold is None:
        raise RequestValidationError("Enter a valid confidence review threshold.")

    requested_objects = _parse_objects(raw_objects)
    image = stored_image_record(image_id)

    if image is None:
        raise KeyError("Image not found.")

    image_path = resolve_backend_path(image["stored_path"])
    if not image_path.is_file():
        raise ModelServiceError("The saved image is missing from local storage.")

    try:
        detections = detect_objects(image_path, requested_objects)
    except Exception as exc:
        raise ModelServiceError("Detection failed. Check the model and backend logs.") from exc

    eligible = []
    for detection in detections:
        confidence = retained_confidence(detection.get("confidence"))
        if confidence is not None:
            eligible.append((detection, confidence))

    height, width = int(image["height"]), int(image["width"])
    masks = []
    if eligible:
        try:
            masks = segment_boxes(
                image_path,
                [detection["bbox"] for detection, _ in eligible],
                (height, width),
            )
        except Exception as exc:
            raise ModelServiceError("Mask generation failed for the new detections.") from exc

    if len(masks) != len(eligible):
        raise ModelServiceError("The segmentation model returned an unexpected number of masks.")

    new_annotations = []
    created_paths = []

    try:
        for (detection, confidence), mask in zip(eligible, masks, strict=True):
            annotation_id = str(uuid.uuid4())
            mask_path, overlay_path = save_mask_artifacts(image_id, annotation_id, mask)
            created_paths.extend([mask_path, overlay_path])
            new_annotations.append({
                "id": annotation_id,
                "class_id": int(detection["class_id"]),
                "object": str(detection["object"]),
                "confidence": confidence,
                "bbox": [float(value) for value in detection["bbox"]],
                "status": "auto_accepted" if confidence >= threshold else "needs_review",
                "reviewed": False,
                "reviewed_at": None,
                "review_action": None,
                "source": "yolo",
                "mask_path": mask_path,
                "mask_overlay_path": overlay_path,
            })

        with edit_dataset() as dataset:
            saved_image = next(
                (item for item in dataset.get("images", []) if item["id"] == image_id),
                None,
            )
            if saved_image is None:
                raise KeyError("Image not found.")

            # Keep existing annotations and append the new results.
            saved_image.setdefault("annotations", []).extend(new_annotations)
            saved_image["requested_objects"] = requested_objects

    except Exception:
        remove_stored_files(created_paths)
        raise

    payload = dataset_payload(read_dataset())
    return {
        **payload,
        "message": None if new_annotations else "No matching objects were detected.",
    }
def rename_stored_image(image_id: str, new_filename: str) -> dict[str, Any]:
    new_filename = Path(new_filename).name.strip()

    if not new_filename:
        raise ValueError("Image name cannot be empty.")

    if Path(new_filename).suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
        raise ValueError("Image name must end with .jpg, .jpeg, or .png.")

    with edit_dataset() as dataset:
        image = next(
            (
                item for item in dataset.get("images", [])
                if item["id"] == image_id
            ),
            None,
        )

        if image is None:
            raise KeyError("Image not found.")

        image["filename"] = new_filename

    return dataset_payload(read_dataset())    
def delete_stored_image(image_id: str) -> dict[str, Any]:
    image = stored_image_record(image_id)

    if image is None:
        raise KeyError("Image not found.")

    paths = [image.get("stored_path")]

    for annotation in image.get("annotations", []):
        paths.append(annotation.get("mask_path"))
        paths.append(annotation.get("mask_overlay_path"))

    with edit_dataset() as dataset:
        dataset["images"] = [
            item for item in dataset.get("images", [])
            if item["id"] != image_id
        ]

    remove_stored_files(paths)

    return dataset_payload(read_dataset())
    
def stored_annotation_record(image_id: str, annotation_id: str) -> dict[str, Any] | None:
    image = stored_image_record(image_id)
    if image is None:
        return None
    return next(
        (
            annotation
            for annotation in image.get("annotations", [])
            if annotation["id"] == annotation_id
            and retained_confidence(annotation.get("confidence")) is not None
        ),
        None,
    )


__all__ = [
    "MAX_IMAGE_BYTES",
    "MAX_ZIP_BYTES",
    "ModelServiceError",
    "RequestValidationError",
    "UnsupportedObjectError",
    "annotate_uploads",
    "create_manual_annotation",
    "dataset_payload",
    "is_manual_annotation",
    "review_annotation",
    "stored_annotation_record",
    "stored_image_record",
    "summarize_images",
]


