const lockedTaskIds = new Set<string>()

export function acquireTaskMutationLock(taskId: string): (() => void) | null {
  if (lockedTaskIds.has(taskId)) {
    return null
  }

  lockedTaskIds.add(taskId)
  let released = false
  return () => {
    if (released) return
    released = true
    lockedTaskIds.delete(taskId)
  }
}

export function isTaskMutationLocked(taskId: string): boolean {
  return lockedTaskIds.has(taskId)
}
