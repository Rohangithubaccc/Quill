import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Quill.AI — Sign In',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#0f0f13', color: '#e8e8f0' }}>
        {children}
      </body>
    </html>
  )
}
