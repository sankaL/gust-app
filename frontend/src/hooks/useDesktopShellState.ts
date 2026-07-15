import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import {
  ApiError,
  createVoiceCapture,
  getSessionStatus,
  logoutSession,
  type SessionStatus,
} from '../lib/api'
import { classifyMicrophoneError, createAudioRecorder, stopMediaStream } from '../lib/microphone'
import { buildAvatarLabel } from '../lib/sessionPresentation'
import { useNotifications } from '../components/Notifications'
import { useSessionGroups } from './useSessionGroups'

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}

export function useDesktopSession() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { notifyError } = useNotifications()
  const sessionQuery = useQuery({ queryKey: ['session-status'], queryFn: getSessionStatus, retry: false })
  const groupsQuery = useSessionGroups(sessionQuery.data)
  const logoutMutation = useMutation({
    mutationFn: () => {
      const csrfToken = sessionQuery.data?.csrf_token
      if (!csrfToken) throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
      return logoutSession(csrfToken)
    },
    onSuccess: () => {
      queryClient.clear()
      void navigate('/login', { replace: true })
    },
    onError: (error) => notifyError(errorMessage(error, 'Logout failed. Refresh and try again.')),
  })
  const user = sessionQuery.data?.user
  const accountInitials = useMemo(
    () => (user ? buildAvatarLabel(user.display_name, user.email) : 'G'),
    [user]
  )
  return { sessionQuery, groupsQuery, logoutMutation, accountInitials }
}

function useVoiceCaptureMutation(session: SessionStatus | undefined) {
  const navigate = useNavigate()
  const { notifyError, notifySuccess } = useNotifications()
  return useMutation({
    mutationFn: (audio: { blob: Blob; filename: string }) => {
      const csrfToken = session?.csrf_token
      if (!csrfToken) throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
      return createVoiceCapture(audio.blob, audio.filename, csrfToken)
    },
    onSuccess: (payload) => {
      notifySuccess('Capture ready for review.')
      void navigate(`/desktop/capture?capture=${payload.capture_id}`)
    },
    onError: (error) => notifyError(errorMessage(error, 'Voice capture could not be prepared.')),
  })
}

export function useDesktopRecorder(session: SessionStatus | undefined) {
  const { notifyError } = useNotifications()
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const captureMutation = useVoiceCaptureMutation(session)

  useEffect(() => () => {
    stopMediaStream(recorderRef.current?.stream)
    stopMediaStream(streamRef.current)
    recorderRef.current = null
    streamRef.current = null
  }, [])

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      notifyError('Microphone capture is unavailable in this browser.')
      return
    }
    setIsLoading(true)
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const settle = () => {
        streamRef.current = null
        recorderRef.current = null
        setIsRecording(false)
      }
      const recorder = createAudioRecorder(stream, ({ blob, filename }) => {
        settle()
        if (blob.size === 0) notifyError('No audio was captured. Try again.')
        else captureMutation.mutate({ blob, filename })
      }, (error) => {
        settle()
        notifyError(classifyMicrophoneError(error))
      })
      streamRef.current = stream
      recorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch (error) {
      stopMediaStream(stream)
      notifyError(classifyMicrophoneError(error))
    } finally {
      setIsLoading(false)
    }
  }

  function stop() {
    const recorder = recorderRef.current
    if (recorder?.state !== 'inactive') recorder?.stop()
  }

  return { isRecording, isLoading, isSaving: captureMutation.isPending, start, stop }
}

export function useAccountMenu() {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  useEffect(() => {
    if (!isOpen) return undefined
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside)
    return () => window.removeEventListener('pointerdown', closeOutside)
  }, [isOpen])
  return { menuRef, isOpen, setIsOpen }
}
