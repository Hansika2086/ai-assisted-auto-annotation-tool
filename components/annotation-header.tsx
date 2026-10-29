"use client"

import { ArrowDown, Check, CircleAlert, ClipboardList, Layers, RefreshCw, ScanLine } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import type { BackendHealth } from "@/frontend/annotation-types"

interface AnnotationHeaderProps {
  health?: BackendHealth
  isOnline: boolean
  isChecking: boolean
  onRetry: () => void
}

export function AnnotationHeader({
  health,
  isOnline,
  isChecking,
  onRetry,
}: AnnotationHeaderProps) {
  const modelStatus =
    health?.models.yolo.loaded && health.models.sam.loaded
      ? "YOLO and SAM ready"
      : "Model weights load locally when first used"

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm shadow-primary/15">
            <ScanLine aria-hidden="true" className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Annotation Studio</p>
            <p className="text-xs text-muted-foreground">Private, local-first workflow</p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Badge
            variant="outline"
            className={
              isOnline
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-border bg-white text-muted-foreground"
            }
          >
            {isOnline ? (
              <Check aria-hidden="true" data-icon="inline-start" />
            ) : (
              <CircleAlert aria-hidden="true" data-icon="inline-start" />
            )}
            {isOnline ? "Local API online" : isChecking ? "Checking API" : "API offline"}
          </Badge>
          {!isOnline && !isChecking ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRetry}
              aria-label="Retry local API connection"
            >
              <RefreshCw aria-hidden="true" data-icon="inline-start" />
              Retry
            </Button>
          ) : null}
        </div>
      </header>

      <section className="grid gap-6 rounded-3xl border border-primary/10 bg-gradient-to-br from-white via-white to-primary/[0.06] p-5 shadow-sm sm:grid-cols-[minmax(0,1fr)_230px] sm:items-center sm:p-7">
        <div className="flex flex-col items-start">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/10 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            Local computer vision
          </p>
          <h1
            aria-label="AI-Assisted Auto-Annotation Tool for Image Datasets"
            className="max-w-3xl text-3xl leading-[1.08] font-semibold tracking-[-0.04em] text-foreground sm:text-4xl"
          >
            AI-Assisted Auto-Annotation Tool{" "}
            <span className="text-primary">for Image Datasets</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            An AI-assisted tool that automatically detects and segments objects in images, reducing manual annotation effort.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a
              href="#setup"
              className={buttonVariants({
                size: "lg",
                className: "shadow-sm shadow-primary/15",
              })}
            >
              Start Annotation
              <ArrowDown aria-hidden="true" data-icon="inline-end" />
            </a>
            <p className="text-xs text-muted-foreground">
              Uploaded images and annotations stay in local folders.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-primary/10 bg-white/85 p-3 shadow-sm shadow-primary/5">
          <p className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Annotation workflow
          </p>
          <ol className="grid grid-cols-3 gap-2" aria-label="Detection, segmentation, and review workflow">
            <li className="flex min-w-0 flex-col items-center gap-2 rounded-xl bg-primary/[0.04] px-2 py-3 text-center">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ScanLine aria-hidden="true" className="size-4" />
              </span>
              <span className="text-[11px] leading-4 font-medium">Detect</span>
            </li>
            <li className="flex min-w-0 flex-col items-center gap-2 rounded-xl bg-violet-50 px-2 py-3 text-center">
              <span className="flex size-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                <Layers aria-hidden="true" className="size-4" />
              </span>
              <span className="text-[11px] leading-4 font-medium">Segment</span>
            </li>
            <li className="flex min-w-0 flex-col items-center gap-2 rounded-xl bg-primary/[0.04] px-2 py-3 text-center">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ClipboardList aria-hidden="true" className="size-4" />
              </span>
              <span className="text-[11px] leading-4 font-medium">Review</span>
            </li>
          </ol>
          <p className="mt-3 px-1 text-[11px] leading-4 text-muted-foreground">
            {isOnline ? modelStatus : "Connect the local API to run real inference."}
          </p>
        </div>
      </section>
    </>
  )
}
