"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { Eye, EyeOff, Loader2, Plus, RotateCcw, Save, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AnnotationRecord, DatasetImage } from "@/frontend/annotation-types"
import { apiUrl } from "@/frontend/api"
import {
  annotationBoxClasses,
  annotationLabelClasses,
  confidenceLabel,
} from "@/components/annotation-status-badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

interface AnnotationCanvasProps {
  image: DatasetImage
  annotations: AnnotationRecord[]
  selectedAnnotationId: string | null
  isBackendOnline: boolean
  isSavingManualAnnotation: boolean
  onSelectAnnotation: (annotationId: string) => void
  onAddManualAnnotation: (
    imageId: string,
    label: string,
    bbox: [number, number, number, number]
  ) => Promise<string | null>
}

interface Rectangle {
  left: number
  top: number
  right: number
  bottom: number
}

type OverlayPlacement =
  | { kind: "label"; left: number; top: number; width: number; text: string }
  | { kind: "marker"; left: number; top: number }

interface OverlayItem {
  annotation: AnnotationRecord
  index: number
  bounds: Rectangle
  placement: OverlayPlacement
}

const LABEL_HEIGHT = 19
const MARKER_SIZE = 21
const LABEL_GAP = 4

function compactLabel(annotation: AnnotationRecord): string {
  const name = annotation.object.trim().replace(/\s+/g, " ") || "object"
  const shortName = name.length > 18 ? `${name.slice(0, 17).trimEnd()}…` : name
  return annotation.confidence == null
    ? shortName
    : `${shortName} ${confidenceLabel(annotation.confidence)}`
}

function confidenceDescription(annotation: AnnotationRecord): string {
  return annotation.confidence == null
    ? "Human Annotated"
    : `${confidenceLabel(annotation.confidence)} confidence`
}

function annotationDescription(annotation: AnnotationRecord): string {
  return `Select ${annotation.object}, ${confidenceDescription(annotation)}`
}

function overlaps(first: Rectangle, second: Rectangle, gap = 0): boolean {
  return (
    first.left < second.right + gap &&
    first.right + gap > second.left &&
    first.top < second.bottom + gap &&
    first.bottom + gap > second.top
  )
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function markerCandidates(bounds: Rectangle, width: number, height: number) {
  const inset = 3
  const steps = [0, MARKER_SIZE + 3, (MARKER_SIZE + 3) * 2, (MARKER_SIZE + 3) * 3]
  const candidates: Array<{ left: number; top: number }> = []

  for (const step of steps) {
    candidates.push(
      { left: bounds.left + inset + step, top: bounds.top + inset },
      { left: bounds.right - MARKER_SIZE - inset - step, top: bounds.top + inset },
      { left: bounds.left + inset, top: bounds.top + inset + step },
      { left: bounds.right - MARKER_SIZE - inset, top: bounds.bottom - MARKER_SIZE - inset - step },
      { left: bounds.left - MARKER_SIZE - inset, top: bounds.top + inset + step },
      { left: bounds.right + inset, top: bounds.top + inset + step }
    )
  }

  return candidates.map((candidate) => ({
    left: clamp(candidate.left, 0, Math.max(0, width - MARKER_SIZE)),
    top: clamp(candidate.top, 0, Math.max(0, height - MARKER_SIZE)),
  }))
}

function createOverlayLayout(
  annotations: AnnotationRecord[],
  image: DatasetImage,
  stageWidth: number,
  stageHeight: number
): OverlayItem[] {
  const items = annotations.map((annotation, index) => {
    const [x1, y1, x2, y2] = annotation.bbox
    const left = (x1 / image.width) * stageWidth
    const top = (y1 / image.height) * stageHeight
    const right = (x2 / image.width) * stageWidth
    const bottom = (y2 / image.height) * stageHeight

    return {
      annotation,
      index,
      bounds: { left, top, right, bottom },
      placement: { kind: "marker", left, top } as OverlayPlacement,
    }
  })

  const ordered = [...items].sort(
    (first, second) =>
      first.bounds.top - second.bounds.top ||
      first.bounds.left - second.bounds.left ||
      first.index - second.index
  )
  const reserved: Rectangle[] = []

  for (const item of ordered) {
    const text = compactLabel(item.annotation)
    const labelWidth = Math.min(stageWidth, Math.max(58, text.length * 5.7 + 14))
    const otherBoxes = items
      .filter((other) => other.index !== item.index)
      .map((other) => other.bounds)
    const horizontalStarts = [
      item.bounds.left,
      item.bounds.left + (item.bounds.right - item.bounds.left - labelWidth) / 2,
      item.bounds.right - labelWidth,
      item.bounds.right + LABEL_GAP,
      item.bounds.left - labelWidth - LABEL_GAP,
    ]
      .map((left) => clamp(left, 0, Math.max(0, stageWidth - labelWidth)))
      .filter((left, index, values) => values.indexOf(left) === index)

    let labelPlacement: OverlayPlacement | null = null
    const maxLanes = Math.min(6, Math.floor(stageHeight / (LABEL_HEIGHT + LABEL_GAP)))

    for (let lane = 0; lane < maxLanes && !labelPlacement; lane += 1) {
      const top = item.bounds.top - LABEL_HEIGHT - LABEL_GAP - lane * (LABEL_HEIGHT + LABEL_GAP)
      if (top < 0 || top + LABEL_HEIGHT > stageHeight) continue

      for (const left of horizontalStarts) {
        const candidate: Rectangle = {
          left,
          top,
          right: left + labelWidth,
          bottom: top + LABEL_HEIGHT,
        }
        const coversObject = otherBoxes.some((box) => overlaps(candidate, box, 2))
        const coversOverlay = reserved.some((rectangle) => overlaps(candidate, rectangle, 3))

        if (!coversObject && !coversOverlay) {
          labelPlacement = { kind: "label", left, top, width: labelWidth, text }
          reserved.push(candidate)
          break
        }
      }
    }

    if (labelPlacement) {
      item.placement = labelPlacement
      continue
    }

    const markerPosition = markerCandidates(item.bounds, stageWidth, stageHeight).find(
      (position) => {
        const marker: Rectangle = {
          left: position.left,
          top: position.top,
          right: position.left + MARKER_SIZE,
          bottom: position.top + MARKER_SIZE,
        }
        return !reserved.some((rectangle) => overlaps(marker, rectangle, 2))
      }
    ) ?? {
      left: clamp(item.bounds.left, 0, Math.max(0, stageWidth - MARKER_SIZE)),
      top: clamp(item.bounds.top, 0, Math.max(0, stageHeight - MARKER_SIZE)),
    }

    item.placement = { kind: "marker", ...markerPosition }
    reserved.push({
      left: markerPosition.left,
      top: markerPosition.top,
      right: markerPosition.left + MARKER_SIZE,
      bottom: markerPosition.top + MARKER_SIZE,
    })
  }

  return items
}

function percent(value: number, extent: number): string {
  return `${(value / extent) * 100}%`
}

export function AnnotationCanvas({
  image,
  annotations,
  selectedAnnotationId,
  isBackendOnline,
  isSavingManualAnnotation,
  onSelectAnnotation,
  onAddManualAnnotation,
}: AnnotationCanvasProps) {
  const canvasRegionRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [availableWidth, setAvailableWidth] = useState(640)
  const [zoom, setZoom] = useState(1)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [isDrawingManual, setIsDrawingManual] = useState(false)
  const [manualBBox, setManualBBox] = useState<Rectangle | null>(null)
  const [manualLabel, setManualLabel] = useState("")
  const [manualError, setManualError] = useState<string | null>(null)

  useEffect(() => {
    const canvasRegion = canvasRegionRef.current
    if (!canvasRegion) return

    const updateWidth = (width: number) => {
      if (width > 0) setAvailableWidth(Math.floor(width))
    }

    updateWidth(canvasRegion.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) updateWidth(width)
    })
    observer.observe(canvasRegion)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setZoom(1)
    setIsDrawingManual(false)
    setManualBBox(null)
    setManualLabel("")
    setManualError(null)
    dragStartRef.current = null
    viewportRef.current?.scrollTo({ left: 0, top: 0 })
  }, [image.id])

  const stageWidth = Math.max(1, Math.min(1120, availableWidth - 16))
  const stageHeight = stageWidth * (image.height / image.width)
  const zoomedWidth = Math.round(stageWidth * zoom)
  const zoomedHeight = stageHeight * zoom
  const overlayItems = useMemo(
    () => createOverlayLayout(annotations, image, zoomedWidth, zoomedHeight),
    [annotations, image, zoomedHeight, zoomedWidth]
  )
  const zoomInputId = `annotation-zoom-${image.id}`

  function resetZoom() {
    setZoom(1)
    viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" })
  }

  function beginManualDrawing() {
    setManualBBox(null)
    setManualLabel("")
    setManualError(null)
    setIsDrawingManual(true)
  }

  function cancelManualAnnotation() {
    dragStartRef.current = null
    setIsDrawingManual(false)
    setManualBBox(null)
    setManualLabel("")
    setManualError(null)
  }

  function imagePointFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    return {
      x: clamp(((event.clientX - bounds.left) / bounds.width) * image.width, 0, image.width),
      y: clamp(((event.clientY - bounds.top) / bounds.height) * image.height, 0, image.height),
    }
  }

  function boxFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): Rectangle {
    return {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      right: Math.max(start.x, end.x),
      bottom: Math.max(start.y, end.y),
    }
  }

  function handleManualPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDrawingManual || event.button !== 0 || !event.isPrimary) return
    const point = imagePointFromPointer(event)
    if (!point) return

    event.preventDefault()
    dragStartRef.current = point
    setManualBBox({ left: point.x, top: point.y, right: point.x, bottom: point.y })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleManualPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current
    const point = start ? imagePointFromPointer(event) : null
    if (start && point) setManualBBox(boxFromPoints(start, point))
  }

  function handleManualPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current
    const point = start ? imagePointFromPointer(event) : null
    if (!start || !point) return

    dragStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const bbox = boxFromPoints(start, point)
    if (bbox.right - bbox.left < 1 || bbox.bottom - bbox.top < 1) {
      setManualBBox(null)
      setManualError("Draw a box at least 1 pixel wide and high.")
      return
    }

    setManualBBox(bbox)
    setManualError(null)
    setIsDrawingManual(false)
  }

  function handleManualPointerCancel() {
    dragStartRef.current = null
    setManualBBox(null)
  }

  async function saveManualAnnotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const objectName = manualLabel.trim()
    if (!manualBBox) return
    if (!objectName) {
      setManualError("Enter an object or class name before saving.")
      return
    }

    const annotationId = await onAddManualAnnotation(image.id, objectName, [
      manualBBox.left,
      manualBBox.top,
      manualBBox.right,
      manualBBox.bottom,
    ])
    if (annotationId) {
      setShowAnnotations(true)
      onSelectAnnotation(annotationId)
      cancelManualAnnotation()
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={showAnnotations ? "secondary" : "outline"}
            size="sm"
            aria-pressed={showAnnotations}
            onClick={() => setShowAnnotations((visible) => !visible)}
          >
            {showAnnotations ? (
              <EyeOff aria-hidden="true" data-icon="inline-start" />
            ) : (
              <Eye aria-hidden="true" data-icon="inline-start" />
            )}
            {showAnnotations ? "Hide Annotations" : "Show Annotations"}
          </Button>
          {manualBBox ? (
            <p className="text-xs text-muted-foreground">Name the box below to save it.</p>
          ) : isDrawingManual ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={cancelManualAnnotation}>
                <X aria-hidden="true" data-icon="inline-start" />
                Cancel drawing
              </Button>
              <span role="status" className="text-xs text-muted-foreground">
                Click and drag on the image to draw a box.
              </span>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={beginManualDrawing}
              disabled={!isBackendOnline || isSavingManualAnnotation}
            >
              <Plus aria-hidden="true" data-icon="inline-start" />
              Add Annotation
            </Button>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-[440px]">
          <label htmlFor={zoomInputId} className="shrink-0 text-xs font-medium text-muted-foreground">
            Zoom
          </label>
          <input
            id={zoomInputId}
            type="range"
            min={1}
            max={4}
            step={0.25}
            value={zoom}
            aria-valuetext={`${Math.round(zoom * 100)} percent`}
            onChange={(event) => setZoom(Number(event.currentTarget.value))}
            className="h-2 min-w-0 flex-1 cursor-pointer accent-primary"
          />
          <output htmlFor={zoomInputId} className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </output>
          <Button type="button" variant="outline" size="sm" onClick={resetZoom} className="shrink-0">
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            Reset zoom
          </Button>
        </div>
      </div>

      <div ref={canvasRegionRef} className="w-full min-w-0">
        <div
          ref={viewportRef}
          role="region"
          aria-label={`${image.filename} annotation canvas`}
          tabIndex={0}
          className="max-h-[min(68vh,760px)] min-h-[280px] w-full overflow-auto rounded-xl border bg-muted/35 p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div
            className={cn(
              "relative mx-auto overflow-hidden rounded-lg bg-white shadow-sm",
              isDrawingManual && "cursor-crosshair touch-none select-none"
            )}
            style={{ width: `${zoomedWidth}px`, height: `${zoomedHeight}px` }}
            onPointerDown={handleManualPointerDown}
            onPointerMove={handleManualPointerMove}
            onPointerUp={handleManualPointerUp}
            onPointerCancel={handleManualPointerCancel}
          >
            <img
              src={apiUrl(image.image_url)}
              alt={image.filename}
              width={image.width}
              height={image.height}
              draggable={false}
              className="absolute inset-0 size-full select-none object-fill"
            />

            {showAnnotations ? (
              <>
                {annotations.map((annotation) =>
                  annotation.mask_url && annotation.status !== "rejected" ? (
                    <img
                      key={`mask-${annotation.id}`}
                      src={apiUrl(annotation.mask_url)}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      className="pointer-events-none absolute inset-0 size-full select-none object-fill opacity-30"
                    />
                  ) : null
                )}

                {overlayItems.map(({ annotation, index, bounds }) => {
                  const isSelected = annotation.id === selectedAnnotationId
                  return (
                    <button
                      key={annotation.id}
                      type="button"
                      aria-label={annotationDescription(annotation)}
                      aria-pressed={isSelected}
                      onClick={() => onSelectAnnotation(annotation.id)}
                      className={cn(
                        "absolute cursor-pointer rounded-[1px] border bg-transparent text-left outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-primary",
                        annotationBoxClasses(annotation.status),
                        isSelected && "ring-1 ring-white ring-offset-1 ring-offset-primary",
                        isDrawingManual && "pointer-events-none"
                      )}
                      style={{
                        left: percent(bounds.left, zoomedWidth),
                        top: percent(bounds.top, zoomedHeight),
                        width: percent(bounds.right - bounds.left, zoomedWidth),
                        height: percent(bounds.bottom - bounds.top, zoomedHeight),
                        zIndex: isSelected ? 20 : 10,
                      }}
                    />
                  )
                })}

                {overlayItems.map(({ annotation, index, placement }) => {
                  const isSelected = annotation.id === selectedAnnotationId
                  if (placement.kind === "label") {
                    return (
                      <button
                        key={`label-${annotation.id}`}
                        type="button"
                        aria-label={annotationDescription(annotation)}
                        aria-pressed={isSelected}
                        title={`${annotation.object} · ${confidenceDescription(annotation)}`}
                        onClick={() => onSelectAnnotation(annotation.id)}
                        className={cn(
                          "absolute z-30 h-[19px] overflow-hidden rounded-[3px] px-1.5 text-left text-[10px] leading-[19px] font-semibold shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-primary",
                          annotationLabelClasses(annotation.status),
                          isSelected && "ring-1 ring-white ring-offset-1 ring-offset-primary",
                          isDrawingManual && "pointer-events-none"
                        )}
                        style={{
                          left: percent(placement.left, zoomedWidth),
                          top: percent(placement.top, zoomedHeight),
                          width: `${placement.width}px`,
                        }}
                      >
                        <span className="block truncate">{placement.text}</span>
                      </button>
                    )
                  }

                  return (
                    <button
                      key={`marker-${annotation.id}`}
                      type="button"
                      aria-label={`Select annotation ${index + 1}: ${annotation.object}, ${confidenceDescription(annotation)}`}
                      aria-pressed={isSelected}
                      title={`${index + 1}. ${annotation.object} · ${confidenceDescription(annotation)}`}
                      onClick={() => onSelectAnnotation(annotation.id)}
                      className={cn(
                        "absolute z-30 flex size-[21px] items-center justify-center rounded-md border-2 border-white text-[10px] leading-none font-bold shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-primary",
                        annotationLabelClasses(annotation.status),
                        isSelected && "ring-1 ring-white ring-offset-1 ring-offset-primary",
                        isDrawingManual && "pointer-events-none"
                      )}
                      style={{
                        left: percent(placement.left, zoomedWidth),
                        top: percent(placement.top, zoomedHeight),
                      }}
                    >
                      {index + 1}
                    </button>
                  )
                })}
              </>
            ) : null}

            {manualBBox ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-40 rounded-sm border-2 border-dashed border-primary bg-primary/15"
                style={{
                  left: percent(manualBBox.left, image.width),
                  top: percent(manualBBox.top, image.height),
                  width: percent(manualBBox.right - manualBBox.left, image.width),
                  height: percent(manualBBox.bottom - manualBBox.top, image.height),
                }}
              />
            ) : null}
          </div>
        </div>

        {manualBBox ? (
          <form
            onSubmit={(event) => void saveManualAnnotation(event)}
            className="mt-3 flex flex-col gap-3 rounded-xl border bg-card p-3"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`manual-class-${image.id}`}>
                  Object or class name
                </FieldLabel>
                <Input
                  id={`manual-class-${image.id}`}
                  value={manualLabel}
                  maxLength={80}
                  placeholder="e.g. car"
                  onChange={(event) => setManualLabel(event.currentTarget.value)}
                  required
                  autoFocus
                />
              </Field>
            </FieldGroup>
            <p className="text-xs text-muted-foreground">
              The box is saved in original image pixels. Human annotations do not have an AI confidence score.
            </p>
            {manualError ? (
              <p role="alert" className="text-sm text-destructive">
                {manualError}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelManualAnnotation}
                disabled={isSavingManualAnnotation}
              >
                <X aria-hidden="true" data-icon="inline-start" />
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!isBackendOnline || isSavingManualAnnotation}
              >
                {isSavingManualAnnotation ? (
                  <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Save aria-hidden="true" data-icon="inline-start" />
                )}
                Save annotation
              </Button>
            </div>
          </form>
        ) : null}
        {manualError && !manualBBox ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {manualError}
          </p>
        ) : null}
      </div>
    </div>
  )
}
