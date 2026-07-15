import { useCallback, useEffect, useRef, useState } from 'react'

import {
  classifyMicrophoneError,
  createAudioRecorder,
  stopMediaStream,
  type RecordedAudio,
} from '../../lib/microphone'
import { useRecordingWakeLock } from './useRecordingWakeLock'

type RecorderCallbacks = {
  onAudio: (audio: RecordedAudio) => void
  onError: (message: string) => void
  onStart: () => void
}

async function openRecorder(callbacks: RecorderCallbacks) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  try {
    const recorder = createAudioRecorder(
      stream,
      (audio) => callbacks.onAudio(audio),
      (error) => callbacks.onError(classifyMicrophoneError(error, { mentionTextCaptureForUnsupported: true }))
    )
    recorder.start()
    callbacks.onStart()
    return { recorder, stream }
  } catch (error) {
    stopMediaStream(stream)
    throw error
  }
}

export function useCaptureRecorder(onAudio: (audio: RecordedAudio) => void) {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useRecordingWakeLock(isRecording)

  const clearRecorder = useCallback(() => {
    recorderRef.current = null
    streamRef.current = null
    setIsRecording(false)
  }, [])
  const start = useCallback(async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone capture is unavailable. You can still use text capture.')
      return false
    }
    setIsLoading(true)
    try {
      const opened = await openRecorder({
        onAudio: (audio) => { clearRecorder(); onAudio(audio) },
        onError: (message) => { clearRecorder(); setError(message) },
        onStart: () => setIsRecording(true),
      })
      recorderRef.current = opened.recorder
      streamRef.current = opened.stream
      return true
    } catch (reason) {
      clearRecorder()
      setError(classifyMicrophoneError(reason, { mentionTextCaptureForUnsupported: true }))
      return false
    } finally {
      setIsLoading(false)
    }
  }, [clearRecorder, onAudio])

  useEffect(() => () => {
    stopMediaStream(recorderRef.current?.stream ?? null)
    stopMediaStream(streamRef.current)
    recorderRef.current = null
    streamRef.current = null
  }, [])

  const stop = () => {
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
  }
  return { isRecording, isLoading, error, setError, start, stop }
}
