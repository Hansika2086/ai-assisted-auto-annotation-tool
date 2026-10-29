export const DEFAULT_AUTO_ACCEPT_THRESHOLD = 0.9

export type AnnotationStatus =
  | "auto_accepted"
  | "needs_review"
  | "accepted"
  | "rejected"
  | "human_annotated"

export interface AnnotationRecord {
  id: string
  class_id: number | null
  object: string
  confidence: number | null
  bbox: [number, number, number, number]
  status: AnnotationStatus
  reviewed: boolean
  reviewed_at: string | null
  review_action: "accept" | "reject" | "edit" | null
  source: "yolo" | "human_corrected" | "manual"
  mask_url: string | null
}

export interface DatasetImage {
  id: string
  filename: string
  width: number
  height: number
  file_size: number
  created_at: string
  requested_objects: string[]
  image_url: string
  annotations: AnnotationRecord[]
}

export interface DatasetSummary {
  total_images: number
  total_detected_objects: number
  auto_accepted_annotations: number
  human_reviewed_annotations: number
  rejected_annotations: number
  final_accepted_annotations: number
}

export interface DatasetPayload {
  images: DatasetImage[]
  summary: DatasetSummary
}

export interface ModelStatus {
  name: string
  loaded: boolean
}

export interface BackendHealth {
  status: "ok" | "error"
  service: string
  storage: string
  models: {
    yolo: ModelStatus
    sam: ModelStatus
  }
}

export interface AnnotationRunResponse {
  images: DatasetImage[]
  dataset: DatasetPayload
  summary: DatasetSummary
  message: string | null
}

export interface ReviewResponse {
  images: DatasetImage[]
  summary: DatasetSummary
}

export interface ManualAnnotationResponse extends ReviewResponse {
  annotation_id: string
}

export type ReviewAction =
  | { action: "accept" }
  | { action: "reject" }
  | { action: "edit"; label: string; bbox: [number, number, number, number] }

export type ExportFormat = "yolo" | "coco" | "segmentation"

export interface LocalFilePreview {
  id: string
  file: File
  previewUrl: string | null
}

export interface UnsupportedClassDetail {
  code?: string
  message: string
  unsupported_objects?: string[]
  supported_classes?: string[]
}

export interface ApiErrorPayload {
  detail?: string | UnsupportedClassDetail | Array<{ msg?: string }>
  message?: string
}
