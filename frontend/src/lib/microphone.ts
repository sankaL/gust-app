export function classifyMicrophoneError(
  error: unknown,
  options: { mentionTextCaptureForUnsupported?: boolean } = {}
): string {
  const fallback = 'Microphone access failed. Check your device settings, then try again.'
  if (!(error instanceof DOMException)) return fallback

  const messages: Record<string, string> = {
    NotAllowedError: 'Microphone permission was denied. Text capture is still available.',
    SecurityError: 'Microphone permission was denied. Text capture is still available.',
    PermissionDeniedError: 'Microphone permission was denied. Text capture is still available.',
    NotFoundError: 'No microphone was found. Connect a mic and try again, or use text capture.',
    DevicesNotFoundError: 'No microphone was found. Connect a mic and try again, or use text capture.',
    NotReadableError: 'Microphone is unavailable or in use by another app. Try again, or use text capture.',
    TrackStartError: 'Microphone is unavailable or in use by another app. Try again, or use text capture.',
    AbortError: 'Microphone is unavailable or in use by another app. Try again, or use text capture.',
  }
  if (error.name === 'OverconstrainedError') {
    return options.mentionTextCaptureForUnsupported
      ? 'Microphone settings are unsupported on this device. Try default audio settings or text capture.'
      : 'Microphone settings are unsupported on this device. Try default audio settings.'
  }
  return messages[error.name] ?? fallback
}

export type RecordedAudio = {
  blob: Blob
  filename: string
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop())
}

export function createAudioRecorder(
  stream: MediaStream,
  onComplete: (audio: RecordedAudio) => void,
  onError: (error: unknown) => void
): MediaRecorder {
  const chunks: BlobPart[] = []
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream)
  } catch (error) {
    stopMediaStream(stream)
    throw error
  }
  let settled = false
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.onstop = () => {
    if (settled) return
    settled = true
    const mimeType = recorder.mimeType || 'audio/webm'
    const fileExtension = mimeType.includes('mp4') ? 'mp4' : 'webm'
    stopMediaStream(stream)
    onComplete({
      blob: new Blob(chunks, { type: mimeType }),
      filename: `capture.${fileExtension}`,
    })
  }
  recorder.onerror = (event) => {
    if (settled) return
    settled = true
    stopMediaStream(stream)
    onError(event.error)
  }
  return recorder
}
