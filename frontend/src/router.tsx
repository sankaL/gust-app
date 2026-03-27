import { createBrowserRouter } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { CaptureRoute } from './routes/CaptureRoute'
import { CompletedTasksRoute } from './routes/CompletedTasksRoute'
import { DesktopModeRoute } from './routes/DesktopModeRoute'
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
      },
      {
        path: 'desktop',
        element: <DesktopModeRoute />
      }
    ]
  }
])
