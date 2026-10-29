"use client"

import {
  CheckCircle2,
  ClipboardCheck,
  Download,
  Image as ImageIcon,
  Loader2,
  ScanLine,
  Sparkles,
  XCircle,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { DatasetPayload, DatasetSummary, ExportFormat } from "@/frontend/annotation-types"

interface DatasetSummaryProps {
  dataset?: DatasetPayload
  isLoading: boolean
  isBackendOnline: boolean
  exportingFormat: ExportFormat | null
  onExport: (format: ExportFormat) => void
}

const statistics: Array<{
  key: keyof DatasetSummary
  label: string
  icon: LucideIcon
}> = [
  { key: "total_images", label: "Total images", icon: ImageIcon },
  { key: "total_detected_objects", label: "Total annotations", icon: ScanLine },
  { key: "auto_accepted_annotations", label: "Auto-accepted annotations", icon: Sparkles },
  { key: "human_reviewed_annotations", label: "Human-reviewed annotations", icon: ClipboardCheck },
  { key: "rejected_annotations", label: "Rejected annotations", icon: XCircle },
  { key: "final_accepted_annotations", label: "Final accepted annotations", icon: CheckCircle2 },
]

export function DatasetSummary({
  dataset,
  isLoading,
  isBackendOnline,
  exportingFormat,
  onExport,
}: DatasetSummaryProps) {
  const canExport =
    isBackendOnline &&
    Boolean(dataset) &&
    (dataset?.summary.final_accepted_annotations ?? 0) > 0 &&
    exportingFormat === null

  return (
    <Card className="border-border/70 shadow-sm shadow-slate-900/[0.025]">
      <CardHeader>
        <CardTitle className="text-base">Dataset overview</CardTitle>
        <CardDescription>
          Counts reflect the annotation records saved by the local backend.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {statistics.map(({ key, label, icon: Icon }) => {
          const value = dataset?.summary[key]
          return (
            <div
              key={key}
              className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-white p-3 sm:p-4"
            >
              <div className="flex items-start gap-2 text-muted-foreground">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <span className="text-xs leading-4">{label}</span>
              </div>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {typeof value === "number" ? value.toLocaleString() : isLoading ? "…" : "—"}
              </p>
            </div>
          )
        })}
      </CardContent>

      <Separator className="mx-6 w-auto" />

      <CardFooter className="flex flex-col items-stretch gap-4 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Export reviewed annotations</p>
          <p className="max-w-xl text-xs leading-5 text-muted-foreground">
            YOLO downloads as a ZIP, COCO as JSON, and Segmentation ZIP contains combined SAM overlays plus individual masks.
          </p>
          {dataset && dataset.summary.final_accepted_annotations === 0 ? (
            <p className="text-xs text-muted-foreground">
              Accept at least one annotation before exporting YOLO or COCO.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 min-[440px]:flex-row min-[440px]:flex-wrap">
          <Button
            type="button"
            variant="outline"
            onClick={() => onExport("yolo")}
            disabled={!canExport}
          >
            {exportingFormat === "yolo" ? (
              <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />
            ) : (
              <Download aria-hidden="true" data-icon="inline-start" />
            )}
            YOLO TXT
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onExport("coco")}
            disabled={!canExport}
          >
            {exportingFormat === "coco" ? (
              <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />
            ) : (
              <Download aria-hidden="true" data-icon="inline-start" />
            )}
            COCO JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onExport("segmentation")}
            disabled={!isBackendOnline || !dataset || dataset.summary.total_images === 0 || exportingFormat !== null}
          >
            {exportingFormat === "segmentation" ? (
              <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />
            ) : (
              <Download aria-hidden="true" data-icon="inline-start" />
            )}
            Segmentation ZIP
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
