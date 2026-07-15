import { ApiError, type ExtractedTask } from '../../lib/api'

export type CaptureErrorState = {
  message: string
  requestId: string | null
  canRetry: boolean
}

export function captureErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export function buildVoiceCaptureError(error: unknown): CaptureErrorState {
  if (!(error instanceof ApiError)) {
    return { message: 'Transcription failed. Please retry the same recording.', requestId: null, canRetry: true }
  }
  const messages: Record<string, string> = {
    transcription_no_speech: 'No speech was detected. Check that your microphone is picking up audio, then retry.',
    invalid_capture: 'No audio was captured. Record a short voice note and retry, or use text capture.',
    transcription_timeout: 'Transcription timed out. Check your connection and retry the same recording.',
    transcription_provider_unavailable: 'Transcription service is temporarily unavailable. Please retry in a moment.',
    transcription_provider_rejected: 'This recording could not be transcribed. Retry with clearer audio or use text capture.',
    transcription_provider_invalid_response: 'Transcription returned an invalid response. Please retry the same recording.',
    transcription_failed: 'Transcription failed. Please retry the same recording.',
  }
  const message = messages[error.code] ?? (error.message.trim() || 'Transcription failed. Please retry the same recording.')
  return { message, requestId: error.requestId, canRetry: error.code in messages }
}

export function resolveCaptureId(
  taskId: string,
  pendingTasks: ExtractedTask[],
  reviewTasks: ExtractedTask[],
  fallbackId: string | null
): string | null {
  return pendingTasks.find((task) => task.id === taskId)?.capture_id
    ?? reviewTasks.find((task) => task.id === taskId)?.capture_id
    ?? fallbackId
}

export function uniqueCaptureIds(tasks: ExtractedTask[]): string[] {
  return [...new Set(tasks.map((task) => task.capture_id))]
}
