import { DesktopStatusTasksRoute } from '../../components/DesktopStatusTasksRoute'

export function DesktopTasksRoute() {
  return (
    <DesktopStatusTasksRoute
      status="open"
      eyebrow="Open tasks"
      title="All Open Tasks"
      errorTitle="Open tasks could not load"
    />
  )
}
