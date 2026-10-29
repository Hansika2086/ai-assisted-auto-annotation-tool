"use client"

import { useEffect, useState } from "react"
import { CircleAlert, Image as ImageIcon, Loader2, ScanLine, X } from "lucide-react"
import { AnnotationCanvas } from "@/components/annotation-canvas"
import { AnnotationDetectionsList } from "@/components/annotation-detections-list"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type {
  AnnotationRecord,
  DatasetPayload,
  ReviewAction,
} from "@/frontend/annotation-types"
import { apiUrl } from "@/frontend/api"

interface ImageReviewPanelProps {
  dataset?: DatasetPayload
  datasetError?: unknown
  isLoading: boolean
  activeImageId: string | null
  isBackendOnline: boolean
  busyAnnotationId: string | null
  isSavingManualAnnotation: boolean
  onSelectImage: (imageId: string) => void
  onCloseImage: () => void
  onAddManualAnnotation: (
    imageId: string,
    label: string,
    bbox: [number, number, number, number]
  ) => Promise<string | null>
  onReview: (
    imageId: string,
    annotationId: string,
    action: ReviewAction
  ) => Promise<boolean>
  objectNames: string
  autoAcceptThreshold: number
isAnnotating: boolean
onReannotate: (imageId: string) => Promise<void>
}

export function ImageReviewPanel({
  dataset,
  datasetError,
  isLoading,
  activeImageId,
  isBackendOnline,
  busyAnnotationId,
  isSavingManualAnnotation,
  onSelectImage,
  onCloseImage,
  onAddManualAnnotation,
  onReview,
  objectNames,
  autoAcceptThreshold,
  isAnnotating,
  onReannotate,
}: ImageReviewPanelProps) {
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [closedImageIds, setClosedImageIds] = useState<string[]>([])
  const [closedIdsLoaded, setClosedIdsLoaded] = useState(false)
  useEffect(() => {
  try {
    const saved = localStorage.getItem("auto-annotation-closed-image-ids")
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        setClosedImageIds(
          parsed.filter((id): id is string => typeof id === "string")
        )
      }
    }
  } catch {
    // Ignore invalid saved workspace preferences.
  } finally {
    setClosedIdsLoaded(true)
  }
}, [])

useEffect(() => {
  if (!closedIdsLoaded) return

  localStorage.setItem(
    "auto-annotation-closed-image-ids",
    JSON.stringify(closedImageIds)
  )
}, [closedImageIds, closedIdsLoaded])
  async function addManualAnnotation(
    imageId: string,
    label: string,
    bbox: [number, number, number, number]
  ): Promise<string | null> {
    const annotationId = await onAddManualAnnotation(imageId, label, bbox)
    if (annotationId) setActiveAnnotationId(annotationId)
    return annotationId
  }
  const images = dataset?.images ?? []
const visibleImages = images.filter(
  (image) => !closedImageIds.includes(image.id)
)
const selectedImage =
  visibleImages.find((image) => image.id === activeImageId) ??
  visibleImages[0] ??
  null
  const needsReviewCount = images.reduce(
    (total, image) =>
      total + image.annotations.filter((annotation) => annotation.status === "needs_review").length,
    0
  )

  return (
    <Card className="h-full border-border/70 shadow-sm shadow-slate-900/[0.025]">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">Annotation workspace</CardTitle>
          <CardDescription className="mt-1">
            Inspect model masks, select detections, and review the saved dataset.
          </CardDescription>
        </div>
        {dataset ? (
          <span className="shrink-0 rounded-full border border-border bg-white px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {needsReviewCount} to review
          </span>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!dataset && isLoading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 rounded-2xl border border-dashed bg-muted/15 text-sm text-muted-foreground" role="status">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Loading locally saved annotations…
          </div>
        ) : null}

        {!dataset && datasetError ? (
          <Empty role="status" className="min-h-64 rounded-2xl border bg-muted/15 p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleAlert aria-hidden="true" className="size-4" />
              </EmptyMedia>
              <EmptyTitle role="heading" aria-level={3}>
                Local dataset unavailable
              </EmptyTitle>
              <EmptyDescription>
                The saved dataset could not be loaded. Check that the local API is running and that backend/outputs/dataset.json is readable.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {dataset && images.length === 0 ? (
          <Empty role="status" className="min-h-64 rounded-2xl border border-dashed bg-muted/15 p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ImageIcon aria-hidden="true" className="size-4" />
              </EmptyMedia>
              <EmptyTitle role="heading" aria-level={3}>
                No images in this dataset yet
              </EmptyTitle>
              <EmptyDescription>
                Choose JPG or PNG images, or a ZIP archive, then enter the object names you want to annotate.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {selectedImage ? (
          <>
            <nav aria-label="Images in the local dataset" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {visibleImages.map((image, index) => {
                const isSelected = image.id === selectedImage.id
                return (
  <div
    key={image.id}
    className={
      isSelected
        ? "relative min-w-36 rounded-xl border border-primary/30 bg-primary/[0.04] p-2"
        : "relative min-w-36 rounded-xl border border-transparent bg-white p-2 hover:border-border"
    }
  >
    <button
      type="button"
      aria-pressed={isSelected}
      aria-label={`Select ${image.filename}`}
      onClick={() => onSelectImage(image.id)}
      className="flex w-full items-center gap-2 pr-5 text-left"
    >
      <span className="size-11 shrink-0 overflow-hidden rounded-lg border bg-muted">
        <img
          src={apiUrl(image.image_url)}
          alt=""
          aria-hidden="true"
          className="size-full object-cover"
        />
      </span>

      <span className="flex min-w-0 flex-col items-start">
        <span
          className="max-w-32 truncate text-xs font-medium"
          title={image.filename}
        >
          {image.filename}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {image.annotations.length}{" "}
          {image.annotations.length === 1 ? "annotation" : "annotations"}
        </span>
      </span>
    </button>

    <button
      type="button"
      aria-label={`Close ${image.filename} in workspace`}
      title="Close image in workspace"
onClick={() => {
  setClosedImageIds((current) =>
    current.includes(image.id) ? current : [...current, image.id]
  )

  if (activeImageId === image.id) {
    const nextImage = images.find(
      (item) => item.id !== image.id && !closedImageIds.includes(item.id)
    )

    if (nextImage) {
      onSelectImage(nextImage.id)
    } else {
      onCloseImage()
    }
  }
}}
      className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-red-50 hover:text-red-600"
    >
      <X className="size-3.5" />
    </button>
  </div>
                )
              })}
            </nav>
            <Button
  type="button"
  onClick={() => void onReannotate(selectedImage.id)}
  disabled={!isBackendOnline || !objectNames.trim() || isAnnotating}
>
  {isAnnotating ? "Re-annotating..." : "Re-annotate Image"}
</Button>
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
              <figure className="min-w-0">
                <AnnotationCanvas
                  image={selectedImage}
                  annotations={selectedImage.annotations}
                  selectedAnnotationId={
                    selectedImage.annotations.some((annotation) => annotation.id === activeAnnotationId)
                      ? activeAnnotationId
                      : selectedImage.annotations[0]?.id ?? null
                  }
                  onSelectAnnotation={setActiveAnnotationId}
                  isBackendOnline={isBackendOnline}
                  isSavingManualAnnotation={isSavingManualAnnotation}
                  onAddManualAnnotation={addManualAnnotation}
                />
                <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
                  <span className="max-w-full truncate font-medium text-foreground" title={selectedImage.filename}>
                    {selectedImage.filename}
                  </span>
                  <span>
                    {selectedImage.width} × {selectedImage.height} px · {selectedImage.annotations.length} {selectedImage.annotations.length === 1 ? "annotation" : "annotations"}
                  </span>
                </figcaption>
              </figure>

              <aside aria-label="Detection details and review actions" className="min-w-0 xl:sticky xl:top-4 xl:self-start">
                <AnnotationDetectionsList
                  image={selectedImage}
                  annotations={selectedImage.annotations}
                  selectedAnnotation={
                    selectedImage.annotations.find((annotation) => annotation.id === activeAnnotationId) ??
                    selectedImage.annotations[0] ??
                    null
                  }
                  isBackendOnline={isBackendOnline}
                  busyAnnotationId={busyAnnotationId}
                  onSelect={setActiveAnnotationId}
                  onReview={onReview}
                />
              </aside>
            </div>
          </>
        ) : null}

        {dataset && images.length > 0 && datasetError ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <CircleAlert aria-hidden="true" className="size-3.5" />
            Showing the last loaded dataset; refresh the local API connection before saving changes.
          </p>
        ) : null}

        {dataset && images.length > 0 && !isBackendOnline ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <ScanLine aria-hidden="true" className="size-3.5" />
            Review controls remain read-only until the local backend reconnects.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
