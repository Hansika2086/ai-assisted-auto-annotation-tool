import { Badge } from "@/components/ui/badge"
import type { AnnotationStatus } from "@/frontend/annotation-types"

const statusLabels: Record<AnnotationStatus, string> = {
  auto_accepted: "Auto Accepted",
  needs_review: "Needs Human Review",
  accepted: "Accepted",
  rejected: "Rejected",
  human_annotated: "Human Annotated",
}

const badgeStyles: Record<AnnotationStatus, string> = {
  auto_accepted: "border-emerald-200 bg-emerald-50 text-emerald-800",
  needs_review: "border-amber-200 bg-amber-50 text-amber-900",
  accepted: "border-primary/20 bg-primary/5 text-primary",
  rejected: "border-rose-200 bg-rose-50 text-rose-800",
  human_annotated: "border-primary/30 bg-primary/[0.07] text-primary",
}

const boxStyles: Record<AnnotationStatus, string> = {
  auto_accepted: "border-emerald-500/90",
  needs_review: "border-amber-500/90",
  accepted: "border-primary/90",
  rejected: "border-rose-500/90",
  human_annotated: "border-primary/90 border-dashed",
}

const labelStyles: Record<AnnotationStatus, string> = {
  auto_accepted: "bg-emerald-700 text-white",
  needs_review: "bg-amber-400 text-amber-950",
  accepted: "bg-primary text-primary-foreground",
  rejected: "bg-rose-700 text-white",
  human_annotated: "bg-primary text-primary-foreground",
}

export function AnnotationStatusBadge({
  status,
}: {
  status: AnnotationStatus
}) {
  return (
    <Badge variant="outline" className={badgeStyles[status]}>
      {statusLabels[status]}
    </Badge>
  )
}

export function annotationBoxClasses(status: AnnotationStatus): string {
  return boxStyles[status]
}

export function annotationLabelClasses(status: AnnotationStatus): string {
  return labelStyles[status]
}

export function confidenceLabel(confidence: number): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(confidence * 100)}%`
}
