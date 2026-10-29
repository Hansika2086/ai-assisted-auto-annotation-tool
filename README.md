# AI-Assisted Auto-Annotation Tool for Image Datasets

An AI-assisted tool that automatically detects and segments objects in images, reducing manual annotation effort.

A local-first image annotation workflow built with a Next.js frontend and a FastAPI backend. The backend runs YOLO object detection and SAM segmentation locally, saves uploads and annotations to folders plus a JSON dataset, supports human review, and exports accepted annotations as YOLO TXT or COCO JSON, and provides a separate ZIP containing combined SAM mask overlays.

There are no hosted inference APIs, API keys, database services, or sample detection results. The default detection weights are YOLO26 Nano (`yolo26n.pt`) and MobileSAM (`mobile_sam.pt`); they download on first use and run locally.

## Requirements

- Windows 10/11 (the commands below use PowerShell)
- Node.js 20.9 or newer and pnpm (the project pins pnpm 12.3.4)
- Python 3.10 or newer
- Internet access for the first model-weight download
- CPU works; inference is faster with a supported NVIDIA GPU and a compatible PyTorch installation

## Install the frontend

Open PowerShell in the project folder:

```powershell
Set-Location "C:\path\to\AI-Auto-Annotation"
pnpm install
```

If `pnpm` is not available, enable Corepack for your Node installation and reopen PowerShell:

```powershell
corepack enable
```

## Create and install the Python backend

In a separate PowerShell window, from the same project folder:

```powershell
Set-Location "C:\path\to\AI-Auto-Annotation"
py -3.11 -m venv backend\.venv
.\backend\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
```

Use an installed Python version in place of `3.11` if needed. If PowerShell blocks virtual-environment activation, allow scripts for this window only, then activate again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\backend\.venv\Scripts\Activate.ps1
```

## Start the app

Keep the backend terminal active and start FastAPI from the project root:

```powershell
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In another PowerShell window, start Next.js:

```powershell
Set-Location "C:\path\to\AI-Auto-Annotation"
pnpm dev
```

Open **http://localhost:3000**. The backend defaults to **http://127.0.0.1:8000**; no environment variables are needed for this setup. If FastAPI runs at a different address, set `NEXT_PUBLIC_API_URL` in the frontend environment before starting Next.js. The backend's `FRONTEND_ORIGINS` variable can add comma-separated development origins to its CORS allowlist.

## Verify with real images

1. Check the API from PowerShell:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:8000/api/health | ConvertTo-Json -Depth 5
   ```

   The API reference is at **http://127.0.0.1:8000/docs**.
2. In the browser, select JPG, JPEG, or PNG files, or a ZIP containing supported images. Each image is limited to 30 MB, each ZIP to 100 MB, combined uploads to 200 MB, and extracted image data to 250 MB.
3. Type one or more class names supported by the current YOLO weights, separated by commas. The input is intentionally blank by default. The default YOLO26n weights use COCO labels; unsupported names return an explicit error.
4. Set the confidence threshold (defaults to 90%) and start annotation. First use downloads YOLO and SAM weights and can take longer; no paid key is required.
5. Review low-confidence detections, accept or reject them, or edit the label and bounding box. A box correction is re-segmented by SAM before it is saved.
6. Export accepted annotations as YOLO TXT or COCO JSON. Use Segmentation ZIP to download one combined color-overlay image per source image with saved, non-rejected SAM masks, plus the individual binary masks and unchanged originals.

The UI displays detections and masks returned by the running backend only. If the backend or models are unavailable, it reports the problem instead of rendering fabricated predictions.

## Local data and exports

- Original uploads: `backend/uploads/`
- Dataset records: `backend/outputs/dataset.json`
- SAM mask overlays: `backend/outputs/masks/`
- Generated exports: `backend/outputs/exports/`
- Combined SAM export: use the **Segmentation ZIP** button; its `segmentation/combined/` folder contains one overlay per source image.
- Downloaded model weights are ignored by Git (`*.pt`, `*.onnx`).

YOLO and COCO exports include auto-accepted and human-accepted annotations. The separate Segmentation ZIP is a visualization export and includes saved masks from all non-rejected detections, including pending review; review these before treating them as final ground truth. These folders contain your local data; back them up before deleting or moving them. Run the backend on `127.0.0.1` for local use and do not expose the development server to the public internet.

## API routes

- `GET /api/health` — backend and model load status
- `GET /api/dataset` — saved annotations and dataset summary
- `POST /api/annotate` — multipart images/ZIP, object names, and confidence threshold
- `PUT /api/reviews/{image_id}/{annotation_id}` — accept, reject, or edit an annotation
- `GET /api/export/yolo` — YOLO TXT dataset ZIP
- `GET /api/export/coco` — COCO JSON
- `GET /api/export/segmentation` — ZIP with combined SAM overlays and individual masks
- `GET /docs` — FastAPI OpenAPI interface
