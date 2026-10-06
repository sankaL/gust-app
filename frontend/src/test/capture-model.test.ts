import { describe, expect, it } from 'vitest'

import { ApiError, type ExtractedTask } from '../lib/api'
import { buildVoiceCaptureError, resolveCaptureId, uniqueCaptureIds } from '../routes/capture/captureModel'

function task(id: string, captureId: string): ExtractedTask {
  return {
    id,
    capture_id: captureId,
    title: id,
    description: null,
    group_id: 'inbox',
    group_name: 'Inbox',
    due_date: null,
    reminder_at: null,
    recurrence_frequency: null,
    recurrence_weekday: null,
    recurrence_day_of_month: null,
    recurrence_month: null,
    top_confidence: 1,
    needs_review: false,
    status: 'pending',
    subtask_titles: [],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  }
}

describe('capture model', () => {
  it('resolves the pending capture before the active review and fallback captures', () => {
    expect(resolveCaptureId('task-1', [task('task-1', 'pending')], [task('task-1', 'review')], 'fallback')).toBe('pending')
    expect(resolveCaptureId('task-2', [], [task('task-2', 'review')], 'fallback')).toBe('review')
    expect(resolveCaptureId('missing', [], [], 'fallback')).toBe('fallback')
  })

  it('returns each capture ID once while preserving task order', () => {
    expect(uniqueCaptureIds([task('one', 'capture-a'), task('two', 'capture-b'), task('three', 'capture-a')]))
      .toEqual(['capture-a', 'capture-b'])
  })

  it('maps retryable provider errors without exposing an arbitrary provider message', () => {
    const result = buildVoiceCaptureError(
      new ApiError('provider details', 'transcription_provider_unavailable', 503, 'request-1'),
    )

    expect(result).toEqual({
      message: 'Transcription service is temporarily unavailable. Please retry in a moment.',
      requestId: 'request-1',
      canRetry: true,
    })
  })

  it('shows the admin-contact message without a retry when AI credits are exhausted', () => {
    const message = "Gust's AI service is unavailable because its usage limit has been reached. Please contact the administrator."
    const result = buildVoiceCaptureError(new ApiError(message, 'ai_service_quota_exceeded', 503, 'request-2'))

    expect(result).toEqual({ message, requestId: 'request-2', canRetry: false })
  })

  it('falls back to an admin-contact message when a configuration error has no message', () => {
    const result = buildVoiceCaptureError(new ApiError('  ', 'config_invalid', 503, null))

    expect(result.message).toContain('contact the administrator')
    expect(result.canRetry).toBe(false)
  })
})
