"use client"

import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AnnotationHeader } from "@/components/annotation-header"
import { DatasetSummary } from "@/components/dataset-summary"
import { ImageReviewPanel } from "@/components/image-review-panel"
import { UploadPanel } from "@/components/upload-panel"
import {
  CircleAlert,
  CircleCheck,
  Info,
  Trash2,
} from "lucide-react"
import { DEFAULT_AUTO_ACCEPT_THRESHOLD } from "@/frontend/annotation-types"
import type {
  ExportFormat,
  LocalFilePreview,
  ReviewAction,
} from "@/frontend/annotation-types"
import {
  apiBaseUrl,
  deleteSavedImage,
  downloadExport,
  fetchBackendHealth,
  fetchDataset,
  reannotateSavedImage,
  saveManualAnnotation,
  saveReview,
  submitAnnotations,
} from "@/frontend/api"

interface FeedbackMessage {
  type: "error" | "success" | "info"
  text: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected local API error occurred."
}

function isSupportedFile(file: File): boolean {
  return /\.(jpe?g|png|zip)$/i.test(file.name)
}

export function AnnotationWorkspace() {
  const {
    data: health,
    error: healthError,
    isLoading: isHealthLoading,
    mutate: refreshHealth,
  } = useSWR("local-annotation-health", fetchBackendHealth, {
    refreshInterval: 8000,
    revalidateOnFocus: true,
    shouldRetryOnError: true,
    errorRetryInterval: 8000,
  })
  const {
    data: dataset,
    error: datasetError,
    isLoading: isDatasetLoading,
    mutate: updateDataset,
  } = useSWR("local-annotation-dataset", fetchDataset, {
    revalidateOnFocus: true,
    shouldRetryOnError: true,
    errorRetryInterval: 8000,
  })

  const [selectedFiles, setSelectedFiles] = useState<LocalFilePreview[]>([])
  const selectedFilesRef = useRef<LocalFilePreview[]>([])
  const [objectNames, setObjectNames] = useState("")
  const [autoAcceptThreshold, setAutoAcceptThreshold] = useState(DEFAULT_AUTO_ACCEPT_THRESHOLD)
  const [activeImageId, setActiveImageId] = useState<string | null>(null)
  const [isAnnotating, setIsAnnotating] = useState(false)
  const [busyAnnotationId, setBusyAnnotationId] = useState<string | null>(null)
  const [isSavingManualAnnotation, setIsSavingManualAnnotation] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null)
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)

  const isBackendOnline = health?.status === "ok" && !healthError

  useEffect(() => {
    return () => {
      selectedFilesRef.current.forEach((entry) => {
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
      })
    }
  }, [])

  function handleFilesAdded(incomingFiles: File[]) {
    if (incomingFiles.length === 0) return
    const supportedFiles = incomingFiles.filter(isSupportedFile)
    const skippedCount = incomingFiles.length - supportedFiles.length

    if (supportedFiles.length > 0) {
      const additions = supportedFiles.map((file) => ({
        id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        previewUrl: /\.(jpe?g|png)$/i.test(file.name) ? URL.createObjectURL(file) : null,
      }))
      const nextFiles = [...selectedFilesRef.current, ...additions]
      selectedFilesRef.current = nextFiles
      setSelectedFiles(nextFiles)
    }

    if (skippedCount > 0) {
      setFeedback({
        type: "error",
        text: "Some files were skipped. Choose JPG, PNG, or ZIP files only.",
      })
    } else {
      setFeedback(null)
    }
  }

  function handleRemoveFile(id: string) {
    const removed = selectedFilesRef.current.find((entry) => entry.id === id)
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
    const nextFiles = selectedFilesRef.current.filter((entry) => entry.id !== id)
    selectedFilesRef.current = nextFiles
    setSelectedFiles(nextFiles)
  }

  function handleClearFiles() {
    selectedFilesRef.current.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
    })
    selectedFilesRef.current = []
    setSelectedFiles([])
  }

  async function handleStartAnnotation() {
    if (!isBackendOnline || selectedFiles.length === 0 || !objectNames.trim()) return

    setIsAnnotating(true)
    setFeedback(null)
    try {
      const result = await submitAnnotations(
        selectedFiles.map((entry) => entry.file),
        objectNames.trim(),
        autoAcceptThreshold
      )
      setActiveImageId(result.images[0]?.id ?? null)
      await updateDataset(result.dataset, { revalidate: false })
      handleClearFiles()
      setFeedback(
        result.message
          ? { type: "info", text: result.message }
          : {
              type: "success",
              text: `${result.images.length} image${result.images.length === 1 ? "" : "s"} annotated and saved locally. Review the results below.`,
            }
      )
      void refreshHealth()
    } catch (error) {
      setFeedback({ type: "error", text: errorMessage(error) })
    } finally {
      setIsAnnotating(false)
    }
  }

  async function handleReview(
    imageId: string,
    annotationId: string,
    action: ReviewAction
  ): Promise<boolean> {
    setBusyAnnotationId(annotationId)
    setFeedback(null)
    try {
      const result = await saveReview(imageId, annotationId, action)
      await updateDataset(
        { images: result.images, summary: result.summary },
        { revalidate: false }
      )
      setFeedback({ type: "success", text: "Review saved to the local dataset." })
      return true
    } catch (error) {
      setFeedback({ type: "error", text: errorMessage(error) })
      return false
    } finally {
      setBusyAnnotationId(null)
    }
  }

  async function handleAddManualAnnotation(
    imageId: string,
    label: string,
    bbox: [number, number, number, number]
  ): Promise<string | null> {
    setIsSavingManualAnnotation(true)
    setFeedback(null)
    try {
      const result = await saveManualAnnotation(imageId, label, bbox)
      await updateDataset(
        { images: result.images, summary: result.summary },
        { revalidate: false }
      )
      setFeedback({ type: "success", text: "Manual annotation saved to the local dataset." })
      return result.annotation_id
    } catch (error) {
      setFeedback({ type: "error", text: errorMessage(error) })
      return null
    } finally {
      setIsSavingManualAnnotation(false)
    }
  }
async function handleReannotate() {
  if (!isBackendOnline || !activeImageId || !objectNames.trim()) {
    setFeedback({
      type: "error",
      text: "Select a saved image and enter an object name first.",
    })
    return
  }

  setIsAnnotating(true)
  setFeedback(null)

  try {
    const result = await reannotateSavedImage(
      activeImageId,
      objectNames.trim(),
      autoAcceptThreshold
    )

    await updateDataset(
      { images: result.images, summary: result.summary },
      { revalidate: false }
    )

    setFeedback({
      type: result.message ? "info" : "success",
      text: result.message || "Image re-annotated successfully.",
    })

    void refreshHealth()
  } catch (error) {
    setFeedback({ type: "error", text: errorMessage(error) })
  } finally {
    setIsAnnotating(false)
  }
}
async function handleDeleteSavedImage(imageId: string) {
  if (!window.confirm("Delete this saved image and all its annotations?")) return

  setDeletingImageId(imageId)

  try {
    const result = await deleteSavedImage(imageId)
    await updateDataset(result, { revalidate: false })

    if (activeImageId === imageId) {
      setActiveImageId(result.images[0]?.id ?? null)
    }

    setFeedback({ type: "success", text: "Image deleted successfully." })
  } catch (error) {
    setFeedback({ type: "error", text: errorMessage(error) })
  } finally {
    setDeletingImageId(null)
  }
}

  async function handleExport(format: ExportFormat) {
    setExportingFormat(format)
    setFeedback(null)
    try {
      await downloadExport(format)
      setFeedback({
        type: "success",
        text: `${format === "yolo" ? "YOLO TXT" : format === "coco" ? "COCO JSON" : "Combined SAM segmentation"} export downloaded from the local backend.`,
      })
    } catch (error) {
      setFeedback({ type: "error", text: errorMessage(error) })
    } finally {
      setExportingFormat(null)
    }
  }

  const feedbackIcon =
    feedback?.type === "success" ? (
      <CircleCheck aria-hidden="true" className="size-4" />
    ) : feedback?.type === "error" ? (
      <CircleAlert aria-hidden="true" className="size-4" />
    ) : (
      <Info aria-hidden="true" className="size-4" />
    )

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to main content
      </a>
      <main
        id="main-content"
        className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-5 px-4 py-5 sm:gap-6 sm:px-6 sm:py-7 lg:px-8"
      >
        <AnnotationHeader
          health={health}
          isOnline={Boolean(isBackendOnline)}
          isChecking={isHealthLoading}
          onRetry={() => {
            void refreshHealth()
          }}
        />

        {healthError ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" className="size-4" />
            <AlertTitle>Local backend unavailable</AlertTitle>
            <AlertDescription>
              {errorMessage(healthError)} The preview never substitutes sample detections for real model output.
            </AlertDescription>
          </Alert>
        ) : null}

        {datasetError && isBackendOnline ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" className="size-4" />
            <AlertTitle>Could not load the saved dataset</AlertTitle>
            <AlertDescription>
              {errorMessage(datasetError)} Check the local dataset JSON and refresh the API connection.
            </AlertDescription>
          </Alert>
        ) : null}

        {feedback ? (
          <Alert
            variant={feedback.type === "error" ? "destructive" : "default"}
            className={
              feedback.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : feedback.type === "info"
                  ? "border-primary/15 bg-primary/[0.035] text-foreground"
                  : undefined
            }
          >
            {feedbackIcon}
            <AlertTitle>
              {feedback.type === "error"
                ? "Action not completed"
                : feedback.type === "success"
                  ? "Saved"
                  : "Annotation update"}
            </AlertTitle>
            <AlertDescription>{feedback.text}</AlertDescription>
          </Alert>
        ) : null}

        <section
          aria-label="Annotation setup and results"
          className="grid min-w-0 gap-5 lg:grid-cols-[minmax(280px,0.62fr)_minmax(0,1.38fr)]"
        >
          <UploadPanel
            selectedFiles={selectedFiles}
            objectNames={objectNames}
            autoAcceptThreshold={autoAcceptThreshold}
            isBackendOnline={Boolean(isBackendOnline)}
            isBackendChecking={isHealthLoading}
            isAnnotating={isAnnotating}
            onFilesAdded={handleFilesAdded}
            onRemoveFile={handleRemoveFile}
            onClearFiles={handleClearFiles}
            onObjectNamesChange={setObjectNames}
            onAutoAcceptThresholdChange={setAutoAcceptThreshold}
            onStart={() => void handleStartAnnotation()}
          />
          <ImageReviewPanel
  dataset={dataset}
  datasetError={datasetError}
  isLoading={isDatasetLoading}
  activeImageId={activeImageId}
  isBackendOnline={Boolean(isBackendOnline)}
  busyAnnotationId={busyAnnotationId}
  isSavingManualAnnotation={isSavingManualAnnotation}
  onSelectImage={setActiveImageId}
  onCloseImage={() => setActiveImageId(null)}
  onReview={handleReview}
  onAddManualAnnotation={handleAddManualAnnotation}
  objectNames={objectNames}
  autoAcceptThreshold={autoAcceptThreshold}
  isAnnotating={isAnnotating}
  onReannotate={handleReannotate}
/>
        </section>
<section className="space-y-4 rounded-xl border p-4">
  <div>
    <h2 className="text-lg font-semibold">Annotated Images</h2>
    <p className="text-sm text-muted-foreground">
      Preview images that have been annotated.
    </p>
  </div>

  {!dataset?.images.some((image) => image.annotations.length > 0) ? (
    <p className="text-sm text-muted-foreground">
      No annotated images yet.
    </p>
  ) : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {dataset.images
        .filter((image) => image.annotations.length > 0)
        .map((image) => (
          <div key={image.id} className="relative space-y-2 rounded-lg border p-3">
  <button
    type="button"
    onClick={() => void handleDeleteSavedImage(image.id)}
    disabled={deletingImageId === image.id}
    title="Delete image permanently"
    aria-label={`Delete ${image.filename}`}
    className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-full bg-white text-red-600 shadow hover:bg-red-50 disabled:opacity-50"
  >
    ×
  </button>
            <img
              src={`${apiBaseUrl}${image.image_url}`}
              alt={image.filename}
              className="h-48 w-full rounded-md bg-muted object-contain"
            />

            <p className="break-words text-sm font-medium">
              {image.filename}
            </p>
          </div>
        ))}
    </div>
  )}
</section>
        <DatasetSummary
          dataset={dataset}
          isLoading={isDatasetLoading}
          isBackendOnline={Boolean(isBackendOnline)}
          exportingFormat={exportingFormat}
          onExport={(format) => void handleExport(format)}
        />

        <footer className="flex flex-col gap-1 border-t border-border/70 pt-4 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Local-first image annotation</span>
          <span>YOLO detection · SAM masks · human review · YOLO / COCO export</span>
        </footer>
      </main>
    </>
  )
}
