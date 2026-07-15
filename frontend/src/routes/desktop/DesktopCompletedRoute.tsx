import { DesktopStatusTasksRoute } from '../../components/DesktopStatusTasksRoute'

export function DesktopCompletedRoute() {
  return (
    <DesktopStatusTasksRoute
      status="completed"
      eyebrow="Completed"
      title="Completed Tasks"
      errorTitle="Completed tasks could not load"
    />
  )
}
