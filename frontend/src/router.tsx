import { createBrowserRouter } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { CaptureRoute } from './routes/CaptureRoute'
import { ManageGroupsRoute } from './routes/ManageGroupsRoute'
import { TaskDetailRoute } from './routes/TaskDetailRoute'
import { TasksRoute } from './routes/TasksRoute'

export const router = createBrowserRouter([
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
        path: 'tasks/groups',
        element: <ManageGroupsRoute />
      },
      {
        path: 'tasks/:taskId',
        element: <TaskDetailRoute />
      }
    ]
  }
])
