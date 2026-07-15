import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import './styles.css'
import { router } from './router'
import { AppProviders } from './providers'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <Suspense
        fallback={
          <main className="grid min-h-screen place-items-center bg-surface text-on-surface">
            <p className="font-body text-sm text-on-surface-variant">Loading Gust...</p>
          </main>
        }
      >
        <RouterProvider router={router} />
      </Suspense>
    </AppProviders>
  </React.StrictMode>
)
