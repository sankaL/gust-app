import { lazy, type ComponentType } from 'react'
import { createBrowserRouter } from 'react-router-dom'

import { LoginRoute } from './routes/LoginRoute'
import { ManageGroupsRoute } from './routes/ManageGroupsRoute'
import { RootRoute } from './routes/RootRoute'

function lazyRoute<T extends ComponentType>(loader: () => Promise<T>) {
  return lazy(async () => ({ default: await loader() }))
}

const AppShell = lazyRoute(() => import('./components/AppShell').then((module) => module.AppShell))
const DesktopShell = lazyRoute(() =>
  import('./components/DesktopShell').then((module) => module.DesktopShell)
)
const CaptureRoute = lazyRoute(() =>
  import('./routes/CaptureRoute').then((module) => module.CaptureRoute)
)
const TasksRoute = lazyRoute(() => import('./routes/TasksRoute').then((module) => module.TasksRoute))
const CompletedTasksRoute = lazyRoute(() =>
  import('./routes/CompletedTasksRoute').then((module) => module.CompletedTasksRoute)
)
const TaskDetailRoute = lazyRoute(() =>
  import('./routes/TaskDetailRoute').then((module) => module.TaskDetailRoute)
)
const SettingsRoute = lazyRoute(() =>
  import('./routes/SettingsRoute').then((module) => module.SettingsRoute)
)
const DesktopDashboardRoute = lazyRoute(() =>
  import('./routes/desktop/DesktopDashboardRoute').then((module) => module.DesktopDashboardRoute)
)
const DesktopTasksRoute = lazyRoute(() =>
  import('./routes/desktop/DesktopTasksRoute').then((module) => module.DesktopTasksRoute)
)
const DesktopCreateTaskRoute = lazyRoute(() =>
  import('./routes/desktop/DesktopCreateTaskRoute').then((module) => module.DesktopCreateTaskRoute)
)
const DesktopTaskDetailRoute = lazyRoute(() =>
  import('./routes/desktop/DesktopTaskDetailRoute').then((module) => module.DesktopTaskDetailRoute)
)
const DesktopCaptureRoute = lazyRoute(() =>
  import('./routes/desktop/DesktopCaptureRoute').then((module) => module.DesktopCaptureRoute)
)
const DesktopCompletedRoute = lazyRoute(() =>
  import('./routes/desktop/DesktopCompletedRoute').then((module) => module.DesktopCompletedRoute)
)
const DesktopGroupsRoute = lazyRoute(() =>
  import('./routes/desktop/DesktopGroupsRoute').then((module) => module.DesktopGroupsRoute)
)
const DesktopGroupDetailRoute = lazyRoute(() =>
  import('./routes/desktop/DesktopGroupDetailRoute').then((module) => module.DesktopGroupDetailRoute)
)

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootRoute />,
  },
  {
    path: '/login',
    element: <LoginRoute />
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        path: 'capture',
        element: <CaptureRoute />
      },
      {
        path: 'tasks',
        element: <TasksRoute />
      },
      {
        path: 'tasks/completed',
        element: <CompletedTasksRoute />
      },
      {
        path: 'tasks/groups',
        element: <ManageGroupsRoute />
      },
      {
        path: 'tasks/:taskId',
        element: <TaskDetailRoute />
      },
      {
        path: 'settings',
        element: <SettingsRoute />
      }
    ]
  },
  {
    path: '/desktop',
    element: <DesktopShell />,
    children: [
      {
        index: true,
        element: <DesktopDashboardRoute />
      },
      {
        path: 'tasks',
        element: <DesktopTasksRoute />
      },
      {
        path: 'tasks/new',
        element: <DesktopCreateTaskRoute />
      },
      {
        path: 'tasks/:taskId',
        element: <DesktopTaskDetailRoute />
      },
      {
        path: 'capture',
        element: <DesktopCaptureRoute />
      },
      {
        path: 'completed',
        element: <DesktopCompletedRoute />
      },
      {
        path: 'groups',
        element: <DesktopGroupsRoute />
      },
      {
        path: 'groups/:groupId',
        element: <DesktopGroupDetailRoute />
      },
      {
        path: 'settings',
        element: <SettingsRoute />
      }
    ]
  }
])
