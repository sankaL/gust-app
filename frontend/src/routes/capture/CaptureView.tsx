import { useState } from 'react'

import { EditExtractedTaskModal } from '../../components/EditExtractedTaskModal'
import { SaveConfirmationToast } from '../../components/SaveConfirmationToast'
import type { ExtractedTask, GroupSummary } from '../../lib/api'

export function CaptureEditModal({ task, groups, csrfToken, onClose, onSave }: { task: ExtractedTask | null; groups: GroupSummary[]; csrfToken: string | null; onClose: () => void; onSave: () => Promise<void> }) {
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  return <>
    <EditExtractedTaskModal task={task} groups={groups} isOpen={Boolean(task && csrfToken)} onClose={onClose} onSave={onSave} onSaved={() => setSaveNotice('Changes saved')} csrfToken={csrfToken ?? ''} />
    <SaveConfirmationToast message={saveNotice} onDismiss={() => setSaveNotice(null)} />
  </>
}
