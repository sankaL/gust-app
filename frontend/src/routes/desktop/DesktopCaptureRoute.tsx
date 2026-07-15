import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'

import { DesktopCaptureReviewView } from '../../components/DesktopCaptureReviewView'
import { DesktopEditExtractedTaskModal } from '../../components/DesktopEditExtractedTaskModal'
import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShellContext'
import { useDesktopCaptureReview } from '../../hooks/useDesktopCaptureReview'
import type { ExtractedTask } from '../../lib/api'

export function DesktopCaptureRoute() {
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const [editTask, setEditTask] = useState<ExtractedTask | null>(null)
  const review = useDesktopCaptureReview(session.csrf_token)
  const header = useMemo(() => ({ eyebrow: 'Capture tasks', title: 'Review Capture', subtitle: review.captureId ? 'Edit, approve, or discard extracted tasks before they join your list' : 'Pending extracted tasks waiting for review' }), [review.captureId])
  useDesktopHeader(header)
  return <><DesktopCaptureReviewView review={review} onEdit={setEditTask} />{editTask && session.csrf_token ? <DesktopEditExtractedTaskModal task={editTask} groups={groups} isOpen onClose={() => setEditTask(null)} onSave={() => review.refresh(editTask.capture_id)} csrfToken={session.csrf_token} timezone={session.timezone} /> : null}</>
}
