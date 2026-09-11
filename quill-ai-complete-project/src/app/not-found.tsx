import Link from 'next/link'

export default function NotFound() {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0f0f13', color: '#e8e8f0', fontFamily: 'Inter, sans-serif' }}>
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: '40px 24px',
        }}>
          <div style={{
            background: '#1e1e28', border: '1px solid #2a2a3a',
            borderRadius: '16px', padding: '40px', textAlign: 'center',
            maxWidth: '440px', width: '100%',
          }}>
            <div style={{
              fontFamily: 'Syne, sans-serif', fontSize: '56px', fontWeight: 800,
              background: 'linear-gradient(135deg, #6c63ff, #f5c842)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text', marginBottom: '8px',
            }}>
              404
            </div>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '20px', fontWeight: 700, marginBottom: '10px' }}>
              Page not found
            </h1>
            <p style={{ fontSize: '13px', color: '#7c7c9a', lineHeight: 1.6, marginBottom: '24px' }}>
              This page doesn&apos;t exist, or it may have moved. Check the URL, or head back to your dashboard.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <Link href="/dashboard" style={{
                background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '8px',
                padding: '10px 22px', fontSize: '14px', fontWeight: 600, textDecoration: 'none',
                fontFamily: 'Inter, sans-serif', display: 'inline-block',
              }}>
                Go to Dashboard
              </Link>
              <Link href="/" style={{
                background: 'transparent', color: '#7c7c9a', border: '1px solid #2a2a3a',
                borderRadius: '8px', padding: '10px 18px', fontSize: '14px', textDecoration: 'none',
                fontFamily: 'Inter, sans-serif', display: 'inline-block',
              }}>
                Home
              </Link>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
