import type { Metadata } from 'next'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import PostHogProvider from '@/components/providers/PostHogProvider'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'

export const metadata: Metadata = {
  title: 'Quill.AI — AI Content Creation Platform',
  description: 'Generate, schedule, and publish AI-powered content for your business.',
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#0f0f13', color: '#e8e8f0', fontFamily: 'Inter, sans-serif', fontSize: '14px' }}>
        <PostHogProvider>
          <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
            <Sidebar />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0f0f13' }}>
              <Topbar />
              <main style={{ flex: 1, overflowY: 'auto' }}>
                <ErrorBoundary section="page">
                  {children}
                </ErrorBoundary>
              </main>
            </div>
          </div>
        </PostHogProvider>
      </body>
    </html>
  )
}
