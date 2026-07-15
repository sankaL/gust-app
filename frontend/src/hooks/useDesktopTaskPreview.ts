import { useSearchParams } from 'react-router-dom'

export function useDesktopTaskPreview() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTaskId = searchParams.get('task')

  function setSelectedTaskId(taskId: string | null) {
    const next = new URLSearchParams(searchParams)
    if (taskId) next.set('task', taskId)
    else next.delete('task')
    setSearchParams(next, taskId ? undefined : { replace: true })
  }

  return {
    selectedTaskId,
    openTaskPreview: (taskId: string) => setSelectedTaskId(taskId),
    closeTaskPreview: () => setSelectedTaskId(null),
  }
}
