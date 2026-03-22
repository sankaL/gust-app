import { createBrowserRouter } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { CaptureRoute } from './routes/CaptureRoute'
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
      }
    ]
  }
])
