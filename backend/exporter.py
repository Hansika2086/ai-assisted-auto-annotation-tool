from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .confidence_policy import retained_confidence
from .storage import EXPORTS_DIR, read_dataset, resolve_backend_path

ACCEPTED_STATUSES = {"auto_accepted", "accepted"}


class NoAcceptedAnnotationsError(ValueError):
    pass


def _is_manual_annotation(annotation: dict[str, Any]) -> bool:
    return (
        annotation.get("source") == "manual"
        or annotation.get("status") == "human_annotated"
    )


def _accepted_annotations(images: list[dict[str, Any]]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    return [
        (image, annotation)
        for image in images
        for annotation in image.get("annotations", [])
        if (
            _is_manual_annotation(annotation)
            and annotation.get("status") == "human_annotated"
        )
        or (
            annotation.get("status") in ACCEPTED_STATUSES
            and retained_confidence(annotation.get("confidence")) is not None
        )
    ]


def _category_names(annotations: list[tuple[dict[str, Any], dict[str, Any]]]) -> list[str]:
    return sorted({str(annotation["object"]) for _, annotation in annotations}, key=str.casefold)


def _export_path(extension: str) -> Path:
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return EXPORTS_DIR / f"auto_annotation_{timestamp}_{extension}"


def build_yolo_export() -> Path:
    dataset = read_dataset()
    images: list[dict[str, Any]] = dataset["images"]
    accepted = _accepted_annotations(images)
    if not accepted:
        raise NoAcceptedAnnotationsError("There are no accepted annotations to export yet.")

    category_names = _category_names(accepted)
    category_ids = {name: index for index, name in enumerate(category_names)}
    accepted_by_image: dict[str, list[dict[str, Any]]] = {}
    for image, annotation in accepted:
        accepted_by_image.setdefault(image["id"], []).append(annotation)

    archive_buffer = BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for image in images:
            image_path = resolve_backend_path(image["stored_path"])
            if not image_path.is_file():
                raise FileNotFoundError(f"Stored image {image['filename']} is missing.")
            stored_filename = image_path.name
            archive.write(image_path, f"images/{stored_filename}")

            label_lines: list[str] = []
            for annotation in accepted_by_image.get(image["id"], []):
                x1, y1, x2, y2 = [float(value) for value in annotation["bbox"]]
                width = float(image["width"])
                height = float(image["height"])
                center_x = ((x1 + x2) / 2) / width
                center_y = ((y1 + y2) / 2) / height
                box_width = (x2 - x1) / width
                box_height = (y2 - y1) / height
                class_id = category_ids[str(annotation["object"])]
                label_lines.append(
                    f"{class_id} {center_x:.6f} {center_y:.6f} {box_width:.6f} {box_height:.6f}"
                )

                mask_path_value = annotation.get("mask_path")
                if mask_path_value:
                    mask_path = resolve_backend_path(mask_path_value)
                    if not mask_path.is_file():
                        raise FileNotFoundError("A saved SAM mask is missing; the export was not created.")
                    archive.write(
                        mask_path,
                        f"masks/{image_path.stem}_{annotation['id']}.png",
                    )
                elif not _is_manual_annotation(annotation):
                    raise FileNotFoundError("A saved SAM mask is missing; the export was not created.")

            label_filename = f"labels/{image_path.stem}.txt"
            archive.writestr(label_filename, "\n".join(label_lines) + ("\n" if label_lines else ""))

        names_yaml = "\n".join(f"  {index}: {json.dumps(name, ensure_ascii=False)}" for index, name in enumerate(category_names))
        archive.writestr(
            "data.yaml",
            f"path: .\ntrain: images\nval: images\nnc: {len(category_names)}\nnames:\n{names_yaml}\n",
        )
        archive.writestr(
            "README.txt",
            "YOLO object-detection labels use normalized class_id x_center y_center width height values.\n"
            "SAM masks for model annotations are included in the masks/ folder.\n"
            "Human annotations are bbox-only and do not include SAM masks.\n",
        )

    output_path = _export_path("yolo.zip")
    output_path.write_bytes(archive_buffer.getvalue())
    return output_path



def build_segmentation_export() -> Path:
    """Create a ZIP containing original images, individual SAM masks, and one combined overlay per image."""
    dataset = read_dataset()
    images: list[dict[str, Any]] = dataset["images"]
    archive_buffer = BytesIO()
    color_palette = [
        (255, 80, 80), (80, 210, 255), (100, 230, 100),
        (230, 100, 230), (40, 180, 255), (255, 200, 60),
        (180, 120, 255), (80, 230, 210), (220, 220, 80),
    ]
    alpha = 0.42
    images_with_masks = 0

    with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for image in images:
            stored_path = resolve_backend_path(image["stored_path"])
            if not stored_path.is_file():
                raise FileNotFoundError(f"Stored image {image.get('filename', stored_path.name)} is missing.")

            original = cv2.imread(str(stored_path), cv2.IMREAD_COLOR)
            if original is None:
                raise ValueError(f"Stored image {stored_path.name} could not be decoded.")

            # Include the original source image so every overlay can be traced back to its input.
            archive.write(stored_path, f"images/{stored_path.name}")
            combined = original.copy()
            has_mask = False
            mask_index = 0

            for annotation in image.get("annotations", []):
                if not isinstance(annotation, dict) or annotation.get("status") == "rejected":
                    continue
                mask_path_value = annotation.get("mask_path")
                if not mask_path_value:
                    # Manual boxes are not SAM masks and must not be presented as segmented.
                    continue

                mask_path = resolve_backend_path(str(mask_path_value))
                if not mask_path.is_file():
                    raise FileNotFoundError(
                        f"A saved SAM mask is missing for annotation {annotation.get('id', 'unknown')}."
                    )
                mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
                if mask is None:
                    raise ValueError(f"SAM mask {mask_path.name} could not be decoded.")
                if mask.shape != original.shape[:2]:
                    mask = cv2.resize(
                        mask,
                        (original.shape[1], original.shape[0]),
                        interpolation=cv2.INTER_NEAREST,
                    )
                binary = mask > 0
                if not np.any(binary):
                    continue

                color = color_palette[mask_index % len(color_palette)]
                # OpenCV images are BGR; colors are intentionally distinct between instances.
                color_array = np.asarray(color, dtype=np.float32)
                combined[binary] = (
                    combined[binary].astype(np.float32) * (1.0 - alpha)
                    + color_array * alpha
                ).astype(np.uint8)

                # Add the individual binary mask as a separate useful artifact.
                archive.write(
                    mask_path,
                    f"segmentation/individual_masks/{stored_path.stem}_{annotation.get('id', mask_index)}.png",
                )
                mask_index += 1
                has_mask = True

            if has_mask:
                success, encoded = cv2.imencode(".png", combined)
                if not success:
                    raise ValueError(f"Combined segmentation image for {stored_path.name} could not be encoded.")
                archive.writestr(
                    f"segmentation/combined/{stored_path.stem}_segmented.png",
                    encoded.tobytes(),
                )
                images_with_masks += 1

        if images_with_masks == 0:
            raise NoAcceptedAnnotationsError(
                "No saved SAM masks are available to combine. Run annotation first and ensure SAM produced masks."
            )

        archive.writestr(
            "README.txt",
            "Combined SAM segmentation export\n"
            "segmentation/combined contains one image per source image with all saved, non-rejected SAM masks overlaid together.\n"
            "segmentation/individual_masks contains the corresponding binary masks.\n"
            "images contains the original source images unchanged.\n"
            "Pending-review detections are included unless rejected; review annotations before using them as final ground truth.\n"
            "Human-created bounding boxes are not SAM masks and are not included in the combined overlays.\n",
        )

    output_path = _export_path("segmentation.zip")
    output_path.write_bytes(archive_buffer.getvalue())
    return output_path


def _mask_polygons(mask_path: Path) -> tuple[list[list[float]], int]:
    mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if mask is None:
        raise FileNotFoundError("A saved SAM mask could not be read; the export was not created.")
    binary = (mask > 0).astype(np.uint8)
    area = int(cv2.countNonZero(binary))
    if area == 0:
        raise ValueError("A saved SAM mask is empty; the export was not created.")

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons: list[list[float]] = []
    for contour in contours:
        points = contour.reshape(-1, 2)
        if len(points) < 3:
            continue
        polygons.append([float(coordinate) for point in points for coordinate in point])
    if not polygons:
        raise ValueError("A saved SAM mask has no exportable polygon; the export was not created.")
    return polygons, area


def build_coco_export() -> Path:
    dataset = read_dataset()
    images: list[dict[str, Any]] = dataset["images"]
    accepted = _accepted_annotations(images)
    if not accepted:
        raise NoAcceptedAnnotationsError("There are no accepted annotations to export yet.")

    category_names = _category_names(accepted)
    category_ids = {name: index + 1 for index, name in enumerate(category_names)}
    image_ids = {image["id"]: index + 1 for index, image in enumerate(images)}
    accepted_by_image: dict[str, list[dict[str, Any]]] = {}
    for image, annotation in accepted:
        accepted_by_image.setdefault(image["id"], []).append(annotation)

    coco_images = []
    coco_annotations = []
    annotation_id = 1
    for image in images:
        stored_path = resolve_backend_path(image["stored_path"])
        if not stored_path.is_file():
            raise FileNotFoundError(f"Stored image {image['filename']} is missing.")
        coco_images.append(
            {
                "id": image_ids[image["id"]],
                "file_name": stored_path.name,
                "width": int(image["width"]),
                "height": int(image["height"]),
                "date_captured": image.get("created_at"),
            }
        )

        for annotation in accepted_by_image.get(image["id"], []):
            x1, y1, x2, y2 = [float(value) for value in annotation["bbox"]]
            is_manual = _is_manual_annotation(annotation)
            mask_path_value = annotation.get("mask_path")
            if mask_path_value:
                mask_path = resolve_backend_path(mask_path_value)
                if not mask_path.is_file():
                    raise FileNotFoundError("A saved SAM mask is missing; the export was not created.")
                segmentation, area = _mask_polygons(mask_path)
            elif is_manual:
                segmentation = []
                area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
            else:
                raise FileNotFoundError("A saved SAM mask is missing; the export was not created.")

            coco_annotation = {
                "id": annotation_id,
                "image_id": image_ids[image["id"]],
                "category_id": category_ids[str(annotation["object"])],
                "segmentation": segmentation,
                "area": area,
                "bbox": [x1, y1, x2 - x1, y2 - y1],
                "iscrowd": 0,
            }
            confidence = retained_confidence(annotation.get("confidence"))
            if confidence is not None:
                coco_annotation["score"] = confidence
            coco_annotations.append(coco_annotation)
            annotation_id += 1

    document = {
        "info": {
            "description": "AI-Assisted Auto-Annotation Tool for Image Datasets",
            "date_created": datetime.now(timezone.utc).isoformat(),
        },
        "licenses": [],
        "images": coco_images,
        "annotations": coco_annotations,
        "categories": [
            {"id": category_ids[name], "name": name, "supercategory": "object"}
            for name in category_names
        ],
    }
    output_path = _export_path("coco.json")
    output_path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path


__all__ = ["NoAcceptedAnnotationsError", "build_coco_export", "build_segmentation_export", "build_yolo_export"]


