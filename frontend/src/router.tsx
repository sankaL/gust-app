import { createBrowserRouter } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { DesktopShell } from './components/DesktopShell'
import { CaptureRoute } from './routes/CaptureRoute'
import { CompletedTasksRoute } from './routes/CompletedTasksRoute'
import { DesktopCompletedRoute } from './routes/desktop/DesktopCompletedRoute'
import { DesktopDashboardRoute } from './routes/desktop/DesktopDashboardRoute'
import { DesktopGroupDetailRoute } from './routes/desktop/DesktopGroupDetailRoute'
import { DesktopGroupsRoute } from './routes/desktop/DesktopGroupsRoute'
import { DesktopTasksRoute } from './routes/desktop/DesktopTasksRoute'
import { LoginRoute } from './routes/LoginRoute'
import { ManageGroupsRoute } from './routes/ManageGroupsRoute'
import { TaskDetailRoute } from './routes/TaskDetailRoute'
import { TasksRoute } from './routes/TasksRoute'

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginRoute />
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
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
        path: 'tasks/:taskId',
        element: <TaskDetailRoute />
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
      }
    ]
  }
])
