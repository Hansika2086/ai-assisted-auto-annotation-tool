# AI-Assisted Auto-Annotation Tool for Image Datasets

An AI-assisted tool that automatically detects and segments objects in images, reducing manual annotation effort.

An image annotation workflow built with a Next.js frontend and a FastAPI backend. The backend runs YOLO object detection and SAM segmentation locally, saves, uploads and annotations to folders with a dataset, supports human review, and exports accepted annotations as YOLO TXT or COCO JSON, and provides a separate ZIP containing combined SAM mask overlays.

### Models and Requirements

The project uses YOLO26 for object detection and MobileSAM for image segmentation. The models run locally on your computer.

## Requirements

- Windows 10/11 (the commands below use PowerShell)
- Node.js 20.9 and pnpm (the project pins pnpm 12.3.4)
- Python 3.10 or newer
- Internet access

# How to Run the Project

## 1. Install the Frontend

Open PowerShell in the project folder and run:

```powershell
pnpm install
```

This installs the packages required for the frontend.

## 2. Set Up the Backend

Open another PowerShell terminal in the project folder and run:

```powershell
py -3.11 -m venv backend\.venv
.\backend\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

This creates a Python environment and installs the backend dependencies. Python 3.11 is used in these commands.

## 3. Start the Application

Start the backend in one terminal:

```powershell
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal:

```powershell
pnpm dev
```

Open http://localhost:3000 in your browser to use the application.

## 4. How to Use the Tool

1. Upload images in JPG, JPEG, or PNG format. You can also upload a ZIP file containing images.
2. Enter the names of the objects you want to detect, separated by commas.
3. Set the confidence threshold. The default value is 90%.
4. Start the annotation process. The tool uses YOLO for object detection and MobileSAM for image segmentation.
5. Review the annotations and accept, reject, or edit the results.
6. Export the annotations in YOLO or COCO format. You can also download the segmentation results.

The first run may take longer because the required model weights may need to be downloaded.

## 5. Where the Files Are Saved

- `backend/uploads/` – uploaded images
- `backend/outputs/dataset.json` – saved annotation details
- `backend/outputs/masks/` – generated segmentation masks
- `backend/outputs/exports/` – exported files

These files are stored locally on your computer.

## 6. API Information

The backend provides API endpoints for checking its status, processing images, managing annotations, and exporting datasets.

- API status: http://127.0.0.1:8000/api/health
- API documentation: http://127.0.0.1:8000/docs

## Technologies Used

- **Frontend:** React, Next.js, TypeScript
- **Backend:** Python, FastAPI
- **Object detection:** YOLO
- **Image segmentation:** MobileSAM
- **Export formats:** YOLO and COCO
