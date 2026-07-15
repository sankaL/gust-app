import { useEffect, useRef } from 'react'

class RecordingWakeLock {
  private sentinel: WakeLockSentinel | null = null
  private requestId = 0
  private recording = false

  setRecording(recording: boolean) {
    this.recording = recording
  }

  async request() {
    if (!this.canRequest() || this.hasActiveLock()) return
    const requestId = ++this.requestId
    try {
      const sentinel = await navigator.wakeLock.request('screen')
      if (this.requestBecameStale(requestId)) {
        await this.releaseSentinel(sentinel)
        return
      }
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null
      })
      this.sentinel = sentinel
    } catch {
      if (requestId === this.requestId) this.sentinel = null
    }
  }

  private canRequest() {
    return Boolean(navigator.wakeLock && document.visibilityState === 'visible' && this.recording)
  }

  private hasActiveLock() {
    return Boolean(this.sentinel && !this.sentinel.released)
  }

  private requestBecameStale(requestId: number) {
    return requestId !== this.requestId || !this.recording || document.visibilityState !== 'visible'
  }

  async release() {
    this.requestId += 1
    const sentinel = this.sentinel
    this.sentinel = null
    if (sentinel) await this.releaseSentinel(sentinel)
  }

  private async releaseSentinel(sentinel: WakeLockSentinel) {
    try {
      await sentinel.release()
    } catch {
      // A stale platform lock must not block recorder cleanup.
    }
  }
}

export function useRecordingWakeLock(isRecording: boolean) {
  const controllerRef = useRef<RecordingWakeLock | null>(null)
  if (!controllerRef.current) controllerRef.current = new RecordingWakeLock()
  const controller = controllerRef.current

  useEffect(() => {
    controller.setRecording(isRecording)
    if (!isRecording) {
      void controller.release()
      return undefined
    }
    void controller.request()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void controller.request()
      else void controller.release()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      void controller.release()
    }
  }, [controller, isRecording])
}
