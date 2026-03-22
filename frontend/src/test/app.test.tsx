import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

import { AppProviders } from '../providers'
import { AppShell } from '../components/AppShell'
import { CaptureRoute } from '../routes/CaptureRoute'
import { TasksRoute } from '../routes/TasksRoute'

function renderWithRoute(initialEntries: string[]) {
  const router = createMemoryRouter(
    [
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
    ],
    { initialEntries }
  )

  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}

describe('app shell', () => {
  it('renders the capture route by default', () => {
    renderWithRoute(['/'])

    expect(screen.getByRole('heading', { name: 'Capture' })).toBeInTheDocument()
    expect(screen.getByText('Voice-first foundation')).toBeInTheDocument()
  })

  it('renders the tasks route', () => {
    renderWithRoute(['/tasks'])

    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.getByText('Inbox')).toBeInTheDocument()
  })
})
