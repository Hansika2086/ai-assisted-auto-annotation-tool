"use client"

import { useState, type FormEvent } from "react"
import { Check, CircleX, Loader2, Pencil, Save, X } from "lucide-react"
import {
  AnnotationStatusBadge,
  confidenceLabel,
} from "@/components/annotation-status-badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type {
  AnnotationRecord,
  DatasetImage,
  ReviewAction,
} from "@/frontend/annotation-types"

interface AnnotationDetectionsListProps {
  image: DatasetImage
  annotations: AnnotationRecord[]
  selectedAnnotation: AnnotationRecord | null
  isBackendOnline: boolean
  busyAnnotationId: string | null
  onSelect: (annotationId: string) => void
  onReview: (
    imageId: string,
    annotationId: string,
    action: ReviewAction
  ) => Promise<boolean>
}

const coordinateNames = ["x1", "y1", "x2", "y2"] as const

function coordinateValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

export function AnnotationDetectionsList({
  image,
  annotations,
  selectedAnnotation,
  isBackendOnline,
  busyAnnotationId,
  onSelect,
  onReview,
}: AnnotationDetectionsListProps) {
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)
  const [label, setLabel] = useState("")
  const [coordinates, setCoordinates] = useState<[string, string, string, string]>([
    "",
    "",
    "",
    "",
  ])
  const [formError, setFormError] = useState<string | null>(null)

  function beginEditing(annotation: AnnotationRecord) {
    onSelect(annotation.id)
    setLabel(annotation.object)
    setCoordinates(annotation.bbox.map(coordinateValue) as [string, string, string, string])
    setFormError(null)
    setEditingAnnotationId(annotation.id)
  }

  async function saveCorrection(
    event: FormEvent<HTMLFormElement>,
    annotation: AnnotationRecord
  ) {
    event.preventDefault()

    const values = coordinates.map((value) => (value.trim() ? Number(value) : Number.NaN))
    const [x1, y1, x2, y2] = values

    if (!label.trim()) {
      setFormError("Enter an object label before saving.")
      return
    }
    if (values.some((value) => !Number.isFinite(value))) {
      setFormError("Enter a valid number for each box coordinate.")
      return
    }
    if (x1 < 0 || y1 < 0 || x2 > image.width || y2 > image.height) {
      setFormError(`Coordinates must stay within this ${image.width} × ${image.height} image.`)
      return
    }
    if (x2 <= x1 || y2 <= y1) {
      setFormError("The bottom-right corner must be to the right of and below the top-left corner.")
      return
    }

    const bbox: [number, number, number, number] = [x1, y1, x2, y2]
    const saved = await onReview(image.id, annotation.id, {
      action: "edit",
      label: label.trim(),
      bbox,
    })
    if (saved) {
      setEditingAnnotationId(null)
      setFormError(null)
    }
  }

  if (annotations.length === 0) {
    return (
      <Empty role="status" className="min-h-40 rounded-xl border bg-muted/15 p-5">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleX aria-hidden="true" className="size-4" />
          </EmptyMedia>
          <EmptyTitle role="heading" aria-level={3}>
            No annotations on this image yet
          </EmptyTitle>
          <EmptyDescription>
            Try a different model-supported class name or confidence threshold, or add an annotation manually.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Annotations</h3>
        <span className="text-xs text-muted-foreground">
          {annotations.length} {annotations.length === 1 ? "annotation" : "annotations"}
        </span>
      </div>

      <ul
        aria-label="Annotations"
        className="flex max-h-[min(68vh,760px)] flex-col gap-2 overflow-y-auto pr-1"
      >
        {annotations.map((annotation, index) => {
          const isSelected = annotation.id === selectedAnnotation?.id
          const isEditing = editingAnnotationId === annotation.id
          const isManual = annotation.source === "manual"
          const isBusy = busyAnnotationId === annotation.id
          const actionsDisabled = !isBackendOnline || busyAnnotationId !== null

          return (
            <li key={annotation.id}>
              <article
                className={cn(
                  "rounded-xl border p-3 transition-colors",
                  isSelected
                    ? "border-primary/35 bg-primary/[0.035]"
                    : "border-border/70 bg-white"
                )}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (isEditing) return
                    setEditingAnnotationId(null)
                    onSelect(annotation.id)
                  }}
                  className="flex w-full min-w-0 items-start gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="break-words text-sm font-semibold text-foreground">
                      {annotation.object}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <AnnotationStatusBadge status={annotation.status} />
                      {annotation.confidence != null ? (
                        <span className="text-xs font-medium tabular-nums text-muted-foreground">
                          {confidenceLabel(annotation.confidence)}
                        </span>
                      ) : null}
                      {isBusy ? (
                        <Loader2 aria-label="Saving review" className="size-3.5 animate-spin text-muted-foreground" />
                      ) : null}
                    </span>
                  </span>
                </button>

                {!isEditing && !isManual ? (
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => void onReview(image.id, annotation.id, { action: "accept" })}
                      disabled={actionsDisabled}
                      aria-label={`Accept ${annotation.object}`}
                      title={`Accept ${annotation.object}`}
                    >
                      <Check aria-hidden="true" data-icon="inline-start" />
                      Accept
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="destructive"
                      onClick={() => void onReview(image.id, annotation.id, { action: "reject" })}
                      disabled={actionsDisabled}
                      aria-label={`Reject ${annotation.object}`}
                      title={`Reject ${annotation.object}`}
                    >
                      <CircleX aria-hidden="true" data-icon="inline-start" />
                      Reject
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => beginEditing(annotation)}
                      disabled={busyAnnotationId !== null}
                      aria-label={`Edit ${annotation.object}`}
                      title={`Edit ${annotation.object}`}
                    >
                      <Pencil aria-hidden="true" data-icon="inline-start" />
                      Edit
                    </Button>
                  </div>
                ) : isEditing ? (
                  <form
                    onSubmit={(event) => void saveCorrection(event, annotation)}
                    className="mt-4 flex flex-col gap-4 border-t pt-4"
                  >
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor={`edit-label-${annotation.id}`}>
                          Object label
                        </FieldLabel>
                        <Input
                          id={`edit-label-${annotation.id}`}
                          value={label}
                          maxLength={80}
                          onChange={(event) => setLabel(event.currentTarget.value)}
                          required
                        />
                      </Field>
                    </FieldGroup>

                    <FieldSet className="gap-3">
                      <FieldLegend variant="label">Bounding box coordinates (pixels)</FieldLegend>
                      <FieldGroup className="grid grid-cols-2 gap-3">
                        {coordinateNames.map((name, coordinateIndex) => {
                          const maximum = name === "x1" || name === "x2" ? image.width : image.height
                          return (
                            <Field key={name}>
                              <FieldLabel htmlFor={`edit-${name}-${annotation.id}`}>
                                {name}
                              </FieldLabel>
                              <Input
                                id={`edit-${name}-${annotation.id}`}
                                type="number"
                                min={0}
                                max={maximum}
                                step="any"
                                value={coordinates[coordinateIndex]}
                                onChange={(event) => {
                                  const next = [...coordinates] as [string, string, string, string]
                                  next[coordinateIndex] = event.currentTarget.value
                                  setCoordinates(next)
                                }}
                                required
                              />
                            </Field>
                          )
                        })}
                      </FieldGroup>
                      <FieldDescription>
                        Keep x values between 0 and {image.width}, and y values between 0 and {image.height}.
                      </FieldDescription>
                    </FieldSet>

                    {formError ? (
                      <p role="alert" className="text-sm text-destructive">
                        {formError}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingAnnotationId(null)
                          setFormError(null)
                        }}
                      >
                        <X aria-hidden="true" data-icon="inline-start" />
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!isBackendOnline || busyAnnotationId !== null}
                      >
                        {isBusy ? (
                          <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />
                        ) : (
                          <Save aria-hidden="true" data-icon="inline-start" />
                        )}
                        Save correction
                      </Button>
                    </div>
                  </form>
                ) : null}

                {!isBackendOnline && !isEditing && !isManual ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Connect the local backend to save review actions.
                  </p>
                ) : null}
              </article>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
