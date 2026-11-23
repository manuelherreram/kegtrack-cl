import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'KegTrack CL', template: '%s · KegTrack CL' },
  description: 'Control de barriles, lotes y comodatos.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="es-CL"><body>{children}</body></html>
}
