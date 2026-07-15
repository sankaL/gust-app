import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAudioRecorder, type RecordedAudio } from '../lib/microphone'

function streamWithStop() {
  const stop = vi.fn()
  return {
    stop,
    stream: { getTracks: () => [{ stop }] } as unknown as MediaStream,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('audio recorder lifecycle', () => {
  it('stops the acquired stream when recorder construction fails', () => {
    const { stream, stop } = streamWithStop()
    vi.stubGlobal('MediaRecorder', class {
      constructor() {
        throw new Error('unsupported')
      }
    })

    expect(() => createAudioRecorder(stream, vi.fn(), vi.fn())).toThrow('unsupported')
    expect(stop).toHaveBeenCalledOnce()
  })

  it('stops the stream and reports terminal recorder errors', () => {
    const { stream, stop } = streamWithStop()
    const onError = vi.fn()
    const onComplete = vi.fn()
    class RecorderMock {
      mimeType = 'audio/webm'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: ((event: { error: Error }) => void) | null = null
    }
    vi.stubGlobal('MediaRecorder', RecorderMock)

    const recorder = createAudioRecorder(stream, onComplete, onError) as unknown as RecorderMock
    const error = new Error('device lost')
    recorder.onerror?.({ error })
    recorder.onstop?.()

    expect(stop).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(error)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('stops the stream and returns the captured audio on normal completion', () => {
    const { stream, stop } = streamWithStop()
    const onComplete = vi.fn()
    class RecorderMock {
      mimeType = 'audio/webm'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: ((event: { error: Error }) => void) | null = null
    }
    vi.stubGlobal('MediaRecorder', RecorderMock)

    const recorder = createAudioRecorder(stream, onComplete, vi.fn()) as unknown as RecorderMock
    recorder.ondataavailable?.({ data: new Blob(['voice']) })
    recorder.onstop?.()

    expect(stop).toHaveBeenCalledOnce()
    const audio = onComplete.mock.calls[0]?.[0] as RecordedAudio
    expect(audio.blob).toBeInstanceOf(Blob)
    expect(audio.filename).toBe('capture.webm')
  })
})
