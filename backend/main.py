from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .confidence_policy import DEFAULT_AUTO_ACCEPT_THRESHOLD
from .annotation_service import (
    MAX_TOTAL_UPLOAD_BYTES,
    MAX_ZIP_BYTES,
    ModelServiceError,
    RequestValidationError,
    UnsupportedObjectError,
    annotate_uploads,
    create_manual_annotation,
    dataset_payload,
    review_annotation,
    stored_annotation_record,
    stored_image_record,
    delete_stored_image,
    reannotate_stored_image,
    rename_stored_image,
)
from .exporter import NoAcceptedAnnotationsError, build_coco_export, build_segmentation_export, build_yolo_export
from .sam_segmenter import SAM_MODEL_NAME, model_status as sam_model_status
from .storage import ensure_storage, resolve_backend_path
from .yolo_detector import YOLO_MODEL_NAME, model_status as yolo_model_status

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_auto_annotation")

app = FastAPI(
    title="AI-Assisted Auto-Annotation API",
    description="Local YOLO detection, SAM segmentation, human review, and dataset export.",
    version="1.0.0",
)

extra_origins = [
    origin.strip()
    for origin in os.environ.get("FRONTEND_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(["http://localhost:3000", "http://127.0.0.1:3000", *extra_origins])),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "OPTIONS", "DELETE"],
    allow_headers=["Content-Type"],
)

ensure_storage()


class ReviewRequest(BaseModel):
    action: Literal["accept", "reject", "edit"]
    label: str | None = Field(default=None, max_length=80)
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)


class ManualAnnotationRequest(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    bbox: list[float] = Field(min_length=4, max_length=4, allow_inf_nan=False)
class RenameImageRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
class ReannotateImageRequest(BaseModel):
    object_names: str = Field(min_length=1, max_length=500)
    auto_accept_threshold: float = Field(
        default=DEFAULT_AUTO_ACCEPT_THRESHOLD,
        ge=0,
        le=1,
    )

@app.get("/api/health")
def health_check() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "AI-Assisted Auto-Annotation API",
        "storage": "local folders and JSON",
        "models": {
            "yolo": yolo_model_status(),
            "sam": sam_model_status(),
        },
    }


@app.get("/api/dataset")
def get_dataset() -> dict[str, object]:
    try:
        return dataset_payload()
    except RuntimeError as exc:
        logger.exception("Could not read the local dataset.")
        raise HTTPException(status_code=500, detail={"message": str(exc)}) from exc


@app.post("/api/annotate")
async def annotate_dataset(
    files: list[UploadFile] = File(...),
    object_names: str = Form(...),
    auto_accept_threshold: float = Form(default=DEFAULT_AUTO_ACCEPT_THRESHOLD),
) -> dict[str, object]:
    if not files:
        raise HTTPException(status_code=400, detail={"message": "Select at least one image or ZIP file."})

    uploads: list[tuple[str, bytes]] = []
    total_upload_bytes = 0
    try:
        for upload in files:
            data = await upload.read(MAX_ZIP_BYTES + 1)
            if len(data) > MAX_ZIP_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail={"message": "Each uploaded image or ZIP file must be 100 MB or smaller."},
                )
            total_upload_bytes += len(data)
            if total_upload_bytes > MAX_TOTAL_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail={"message": "The combined upload size must be 200 MB or smaller."},
                )
            uploads.append((upload.filename or "image", data))

        return await run_in_threadpool(
            annotate_uploads,
            uploads,
            object_names,
            auto_accept_threshold,
        )
    except UnsupportedObjectError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unsupported_class",
                "message": "Object is not supported by current YOLO model.",
                "unsupported_objects": exc.unsupported_objects,
                "supported_classes": exc.supported_classes,
            },
        ) from exc
    except RequestValidationError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    except ModelServiceError as exc:
        logger.exception("The local YOLO/SAM pipeline could not complete.")
        raise HTTPException(
            status_code=503,
            detail={"code": "model_error", "message": str(exc)},
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected error while annotating uploaded images.")
        raise HTTPException(
            status_code=500,
            detail={"code": "annotation_error", "message": "Annotation failed. Check the backend log and try again."},
        ) from exc
    finally:
        for upload in files:
            await upload.close()


@app.post("/api/images/{image_id}/annotations")
async def add_manual_annotation(
    image_id: str,
    annotation: ManualAnnotationRequest,
) -> dict[str, object]:
    try:
        return await run_in_threadpool(
            create_manual_annotation,
            image_id,
            annotation.label,
            annotation.bbox,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc).strip("'")}) from exc
    except RequestValidationError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    except Exception as exc:
        logger.exception("The manual annotation could not be saved.")
        raise HTTPException(
            status_code=500,
            detail={"message": "The manual annotation could not be saved to the local dataset."},
        ) from exc


@app.put("/api/reviews/{image_id}/{annotation_id}")
async def review_detection(
    image_id: str,
    annotation_id: str,
    review: ReviewRequest,
) -> dict[str, object]:
    try:
        return await run_in_threadpool(
            review_annotation,
            image_id,
            annotation_id,
            review.action,
            review.label,
            review.bbox,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc).strip("'")}) from exc
    except RequestValidationError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    except ModelServiceError as exc:
        logger.exception("SAM could not apply the requested review correction.")
        raise HTTPException(status_code=503, detail={"message": str(exc)}) from exc
    except Exception as exc:
        logger.exception("The annotation review could not be saved.")
        raise HTTPException(
            status_code=500,
            detail={"message": "The review could not be saved to the local dataset."},
        ) from exc


@app.get("/api/images/{image_id}/file")
def get_image_file(image_id: str) -> FileResponse:
    image = stored_image_record(image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    try:
        image_path = resolve_backend_path(image["stored_path"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="The stored image path is invalid.") from exc
    if not image_path.is_file():
        raise HTTPException(status_code=404, detail="The uploaded image is missing from local storage.")
    return FileResponse(image_path, media_type="image/jpeg" if image_path.suffix.lower() in {".jpg", ".jpeg"} else "image/png")


@app.get("/api/images/{image_id}/annotations/{annotation_id}/mask")
def get_annotation_mask(image_id: str, annotation_id: str) -> FileResponse:
    annotation = stored_annotation_record(image_id, annotation_id)
    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found.")
    relative_path = annotation.get("mask_overlay_path")
    if not relative_path:
        raise HTTPException(status_code=404, detail="The SAM mask is not available.")
    try:
        mask_path = resolve_backend_path(relative_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="The stored mask path is invalid.") from exc
    if not mask_path.is_file():
        raise HTTPException(status_code=404, detail="The SAM mask is missing from local storage.")
    return FileResponse(mask_path, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.get("/api/export/yolo")
async def export_yolo() -> FileResponse:
    try:
        export_path = await run_in_threadpool(build_yolo_export)
    except NoAcceptedAnnotationsError as exc:
        raise HTTPException(status_code=409, detail={"message": str(exc)}) from exc
    except Exception as exc:
        logger.exception("YOLO export failed.")
        raise HTTPException(status_code=500, detail={"message": "YOLO export failed. Check the local dataset and try again."}) from exc
    return FileResponse(
        export_path,
        media_type="application/zip",
        filename="ai-auto-annotation-yolo.zip",
    )


@app.get("/api/export/coco")
async def export_coco() -> FileResponse:
    try:
        export_path = await run_in_threadpool(build_coco_export)
    except NoAcceptedAnnotationsError as exc:
        raise HTTPException(status_code=409, detail={"message": str(exc)}) from exc
    except Exception as exc:
        logger.exception("COCO export failed.")
        raise HTTPException(status_code=500, detail={"message": "COCO export failed. Check the local dataset and try again."}) from exc
    return FileResponse(
        export_path,
        media_type="application/json",
        filename="ai-auto-annotation-coco.json",
    )


@app.get("/api/export/segmentation")
async def export_segmentation() -> FileResponse:
    try:
        export_path = await run_in_threadpool(build_segmentation_export)
    except NoAcceptedAnnotationsError as exc:
        raise HTTPException(status_code=409, detail={"message": str(exc)}) from exc
    except Exception as exc:
        logger.exception("Combined SAM segmentation export failed.")
        raise HTTPException(
            status_code=500,
            detail={"message": "Combined segmentation export failed. Check the local dataset and saved SAM masks."},
        ) from exc
    return FileResponse(
        export_path,
        media_type="application/zip",
        filename="ai-auto-annotation-segmentation.zip",
    )


@app.get("/")
def api_root() -> dict[str, str]:
    return {"message": "AI-Assisted Auto-Annotation API. Open /docs for the local API reference."}

@app.delete("/api/images/{image_id}")
async def delete_image(image_id: str):
    try:
        return await run_in_threadpool(delete_stored_image, image_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail={"message": str(exc).strip("'")},
        ) from exc
    except Exception as exc:
        logger.exception("Could not delete the saved image.")
        raise HTTPException(
            status_code=500,
            detail={"message": "Could not delete the image from the local dataset."},
        ) from exc
@app.post("/api/images/{image_id}/reannotate")
async def reannotate_image(
    image_id: str,
    request: ReannotateImageRequest,
):
    try:
        return await run_in_threadpool(
            reannotate_stored_image,
            image_id,
            request.object_names,
            request.auto_accept_threshold,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail={"message": str(exc).strip("'")},
        ) from exc
    except (RequestValidationError, ModelServiceError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"message": str(exc)},
        ) from exc
@app.put("/api/images/{image_id}/rename")
async def rename_image(
    image_id: str,
    request: RenameImageRequest,
):
    try:
        return await run_in_threadpool(
            rename_stored_image,
            image_id,
            request.filename,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail={"message": str(exc).strip("'")},
        ) from exc
    except RequestValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={"message": str(exc)},
        ) from exc