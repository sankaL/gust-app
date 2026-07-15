import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useOutletContext } from 'react-router-dom'

import { TaskForm } from '../../components/TaskForm'
import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShellContext'
import { useNotifications } from '../../components/Notifications'
import { ApiError, createTask, type TaskRecurrence } from '../../lib/api'
import { dateTimeLocalToIso } from '../../lib/dateTime'

type TaskFormData = {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  recurrence: TaskRecurrence | null
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

export function DesktopCreateTaskRoute() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const { notifyError, notifySuccess } = useNotifications()
  const [formError, setFormError] = useState<string | null>(null)

  const header = useMemo(
    () => ({
      eyebrow: 'Create task',
      title: 'New Task',
      subtitle: 'Add a task directly from the desktop workspace',
    }),
    []
  )
  useDesktopHeader(header)

  const createMutation = useMutation({
    mutationFn: async (data: TaskFormData) => {
      const csrfToken = session.csrf_token
      if (!csrfToken) {
        throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
      }

      return createTask(
        {
          title: data.title,
          description: data.description || null,
          group_id: data.groupId,
          due_date: data.dueDate || null,
          reminder_at: dateTimeLocalToIso(data.reminderAt, session.timezone),
          recurrence: data.recurrence,
        },
        csrfToken
      )
    },
    onSuccess: async (task) => {
      setFormError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['desktop', 'tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
      ])
      notifySuccess('Task created.')
      void navigate(`/desktop/tasks/${task.id}`)
    },
    onError: (error) => {
      const message = buildFriendlyMessage(error, 'Task could not be created.')
      setFormError(message)
      notifyError(message)
    },
  })

  return (
    <section className="mx-auto max-w-3xl">
      <div className="rounded-soft border border-white/10 bg-surface-dim/80 p-6 shadow-ambient">
        <TaskForm
          mode="create"
          groups={groups}
          defaultGroupId={session.inbox_group_id ?? groups[0]?.id}
          onSave={(data) => createMutation.mutate(data)}
          onCancel={() => {
            void navigate('/desktop/tasks')
          }}
          isSaving={createMutation.isPending}
          error={formError}
          onErrorChange={setFormError}
        />
      </div>
    </section>
  )
}
