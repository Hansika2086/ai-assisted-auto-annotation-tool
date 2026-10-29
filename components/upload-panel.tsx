"use client"

import { useRef, useState, type DragEvent, type FormEvent } from "react"
import { Archive, Image as ImageIcon, Loader2, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { LocalFilePreview } from "@/frontend/annotation-types"

interface UploadPanelProps {
  selectedFiles: LocalFilePreview[]
  objectNames: string
  autoAcceptThreshold: number
  isBackendOnline: boolean
  isBackendChecking: boolean
  isAnnotating: boolean
  onFilesAdded: (files: File[]) => void
  onRemoveFile: (id: string) => void
  onClearFiles: () => void
  onObjectNamesChange: (value: string) => void
  onAutoAcceptThresholdChange: (value: number) => void
  onStart: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  const scaled = bytes / 1024 ** (unitIndex + 1)
  return `${scaled.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function UploadPanel({
  selectedFiles,
  objectNames,
  autoAcceptThreshold,
  isBackendOnline,
  isBackendChecking,
  isAnnotating,
  onFilesAdded,
  onRemoveFile,
  onClearFiles,
  onObjectNamesChange,
  onAutoAcceptThresholdChange,
  onStart,
}: UploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const canStart =
    isBackendOnline &&
    selectedFiles.length > 0 &&
    objectNames.trim().length > 0 &&
    !isAnnotating

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDragging(false)
    onFilesAdded(Array.from(event.dataTransfer.files))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canStart) onStart()
  }

  return (
    <Card id="setup" className="h-full border-border/70 shadow-sm shadow-slate-900/[0.025]">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Start a dataset</CardTitle>
            <CardDescription className="mt-1">
              Upload images and choose the object names to detect.
            </CardDescription>
          </div>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
            <Upload aria-hidden="true" className="size-4" />
          </span>
        </div>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="dataset-files">Dataset files</FieldLabel>
              <label
                htmlFor="dataset-files"
                onDragEnter={(event) => {
                  event.preventDefault()
                  setIsDragging(true)
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-5 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40",
                  isDragging
                    ? "border-primary bg-primary/[0.06]"
                    : "border-border bg-muted/25 hover:border-primary/40 hover:bg-primary/[0.025]"
                )}
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-white text-primary shadow-sm">
                  <Upload aria-hidden="true" className="size-4" />
                </span>
                <span className="text-sm font-medium">
                  Drop images or a ZIP, or <span className="text-primary">browse files</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  JPG / JPEG / PNG · each image up to 30 MB · each ZIP up to 100 MB · 200 MB total
                </span>
                <Input
                  id="dataset-files"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,.jpg,.jpeg,.png,.zip,application/zip,application/x-zip-compressed"
                  className="sr-only"
                  onChange={(event) => {
                    onFilesAdded(Array.from(event.currentTarget.files ?? []))
                    event.currentTarget.value = ""
                  }}
                />
              </label>
              <input
  ref={folderInputRef}
  type="file"
  multiple
  accept="image/jpeg,image/png,.jpg,.jpeg,.png"
  {...({ webkitdirectory: "", directory: "" } as any)}
  className="hidden"
  aria-label="Choose a folder of images"
  onChange={(event) => {
    onFilesAdded(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ""
  }}
/>

<Button
  type="button"
  variant="outline"
  className="w-full"
  disabled={isAnnotating}
  onClick={() => folderInputRef.current?.click()}
>
  <ImageIcon className="size-4" />
  Choose Image Folder
</Button>
              <FieldDescription>
                ZIP archives are unpacked by the local backend. Files are not sent to a hosted model service.
              </FieldDescription>
            </Field>

            {selectedFiles.length > 0 ? (
              <div className="rounded-xl border bg-background p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-foreground">
                    {selectedFiles.length} selected {selectedFiles.length === 1 ? "file" : "files"}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onClearFiles}
                    className="text-muted-foreground"
                  >
                    Clear all
                  </Button>
                </div>
                <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-1">
                  {selectedFiles.map(({ id, file, previewUrl }) => {
                    const isZip = file.name.toLowerCase().endsWith(".zip")
                    return (
                      <li
                        key={id}
                        className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/35 p-2"
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white text-primary">
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt=""
                              aria-hidden="true"
                              className="size-full object-cover"
                            />
                          ) : isZip ? (
                            <Archive aria-hidden="true" className="size-4" />
                          ) : (
                            <ImageIcon aria-hidden="true" className="size-4" />
                          )}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-xs font-medium" title={file.name}>
                            {file.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {isZip ? "ZIP archive" : "Image"} · {formatFileSize(file.size)}
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => onRemoveFile(id)}
                          className="shrink-0 text-muted-foreground"
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}

            <Field>
              <FieldLabel htmlFor="object-names">What do you want to find?</FieldLabel>
              <Input
                id="object-names"
                value={objectNames}
                onChange={(event) => onObjectNamesChange(event.currentTarget.value)}
                placeholder="Enter object(s) you want to detect..."
                autoComplete="off"
                required
              />
              <FieldDescription>
                Enter one or more class names separated by commas. Names are checked against the current YOLO model.
              </FieldDescription>
            </Field>

            <section aria-labelledby="confidence-threshold-heading" className="flex flex-col gap-2">
              <h3 id="confidence-threshold-heading" className="text-sm font-medium leading-none">
                Confidence Review Threshold
              </h3>
              <div className="flex items-center gap-3">
                <input
                  id="confidence-review-threshold"
                  type="range"
                  min={25}
                  max={100}
                  step={1}
                  value={Math.round(autoAcceptThreshold * 100)}
                  disabled={isAnnotating}
                  aria-label="Confidence Review Threshold"
                  aria-valuetext={`${Math.round(autoAcceptThreshold * 100)}%`}
                  aria-describedby="confidence-threshold-description confidence-review-description"
                  onChange={(event) =>
                    onAutoAcceptThresholdChange(Number(event.currentTarget.value) / 100)
                  }
                  className="h-2 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                />
                <output
                  htmlFor="confidence-review-threshold"
                  className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums"
                >
                  {Math.round(autoAcceptThreshold * 100)}%
                </output>
              </div>
              <p id="confidence-threshold-description" className="text-xs leading-5 text-muted-foreground">
                Set the confidence level for automatic acceptance.
              </p>
              <p id="confidence-review-description" className="text-xs leading-5 text-muted-foreground">
                Lower-confidence detections are sent for human review.
              </p>
            </section>
          </FieldGroup>
        </CardContent>

        <CardFooter className="flex-col items-stretch gap-3">
          {!isBackendOnline ? (
            <p className="text-xs text-muted-foreground" role="status">
              {isBackendChecking
                ? "Checking the local API connection…"
                : "Connect the local FastAPI backend to run YOLO and SAM."}
            </p>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={!canStart}>
            {isAnnotating ? (
              <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />
            ) : (
              <Upload aria-hidden="true" data-icon="inline-start" />
            )}
            {isAnnotating ? "Running YOLO + SAM…" : "Start Auto-Annotation"}
          </Button>
          <p className="text-center text-[11px] leading-4 text-muted-foreground">
            Images, masks, and dataset JSON are stored on this machine.
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
