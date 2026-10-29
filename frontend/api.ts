import type {
  ApiErrorPayload,
  AnnotationRunResponse,
  BackendHealth,
  DatasetPayload,
  ExportFormat,
  ManualAnnotationResponse,
  ReviewAction,
  ReviewResponse,
} from "@/frontend/annotation-types"

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || "http://127.0.0.1:8000"
).replace(/\/+$/, "")

export function apiUrl(path: string): string {
  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`
}

async function fetchApi(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(apiUrl(path), { ...init, cache: "no-store" })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Could not reach the local API at ${API_BASE_URL}. Start FastAPI or set NEXT_PUBLIC_API_URL.`
      )
    }
    throw error
  }
}

async function responseError(response: Response): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null
  const detail = payload?.detail

  if (typeof detail === "string") {
    return new Error(detail)
  }

  if (Array.isArray(detail)) {
    const message = detail
      .map((entry) => entry.msg)
      .filter((entry): entry is string => Boolean(entry))
      .join(" ")
    if (message) return new Error(message)
  }

  if (detail && typeof detail === "object" && "message" in detail) {
    if (detail.unsupported_objects?.length) {
      return new Error(
        `${detail.message} Unsupported: ${detail.unsupported_objects.join(", ")}.`
      )
    }
    return new Error(detail.message)
  }

  return new Error(payload?.message || `Request failed (${response.status}).`)
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchApi(path, init)
  if (!response.ok) throw await responseError(response)
  return (await response.json()) as T
}

export function fetchBackendHealth(): Promise<BackendHealth> {
  return requestJson<BackendHealth>("/api/health")
}

export function fetchDataset(): Promise<DatasetPayload> {
  return requestJson<DatasetPayload>("/api/dataset")
}

export async function submitAnnotations(
  files: File[],
  objectNames: string,
  autoAcceptThreshold: number
): Promise<AnnotationRunResponse> {
  const body = new FormData()
  files.forEach((file) => body.append("files", file, file.name))
  body.append("object_names", objectNames)
  body.append("auto_accept_threshold", String(autoAcceptThreshold))

  const response = await fetchApi("/api/annotate", {
    method: "POST",
    body,
  })
  if (!response.ok) throw await responseError(response)
  return (await response.json()) as AnnotationRunResponse
}

export function saveManualAnnotation(
  imageId: string,
  label: string,
  bbox: [number, number, number, number]
): Promise<ManualAnnotationResponse> {
  return requestJson<ManualAnnotationResponse>(
    `/api/images/${encodeURIComponent(imageId)}/annotations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, bbox }),
    }
  )
}

export function saveReview(
  imageId: string,
  annotationId: string,
  action: ReviewAction
): Promise<ReviewResponse> {
  return requestJson<ReviewResponse>(
    `/api/reviews/${encodeURIComponent(imageId)}/${encodeURIComponent(annotationId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    }
  )
}

export async function downloadExport(format: ExportFormat): Promise<void> {
  const response = await fetchApi(`/api/export/${format}`)
  if (!response.ok) throw await responseError(response)

  const blobUrl = URL.createObjectURL(await response.blob())
  const disposition = response.headers.get("content-disposition") || ""
  const filename =
    /filename="?([^";]+)"?/i.exec(disposition)?.[1] ??
    (format === "yolo"
      ? "ai-auto-annotation-yolo.zip"
      : format === "coco"
        ? "ai-auto-annotation-coco.json"
        : "ai-auto-annotation-segmentation.zip")
  const link = document.createElement("a")
  link.href = blobUrl
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
}

export const apiBaseUrl = API_BASE_URL
export async function deleteSavedImage(imageId: string): Promise<DatasetPayload> {
  return requestJson<DatasetPayload>(
    `/api/images/${encodeURIComponent(imageId)}`,
    { method: "DELETE" }
  )
}
export async function renameSavedImage(
  imageId: string,
  filename: string
): Promise<DatasetPayload> {
  return requestJson<DatasetPayload>(
    `/api/images/${encodeURIComponent(imageId)}/rename`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    }
  )
}

export async function reannotateSavedImage(
  imageId: string,
  objectNames: string,
  autoAcceptThreshold: number
): Promise<DatasetPayload & { message?: string | null }> {
  return requestJson<DatasetPayload & { message?: string | null }>(
    `/api/images/${encodeURIComponent(imageId)}/reannotate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        object_names: objectNames,
        auto_accept_threshold: autoAcceptThreshold,
      }),
    }
  )
}