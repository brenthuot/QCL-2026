import './globals.css'
import { IBM_Plex_Mono } from 'next/font/google'

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
})

export const metadata = {
  title: '⚾ QCL 2026 Draft',
  description: 'QCL 2026 Fantasy Baseball Draft Assistant',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={mono.variable}>
      <body>{children}</body>
    </html>
  )
}
