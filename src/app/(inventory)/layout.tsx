import { Barrel, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { logout } from '@/lib/actions'
import { requireUser } from '@/lib/auth'
import { Navigation } from '@/components/navigation'

export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const user = await requireUser()
  return <div className="shell">
    <header className="topbar no-print">
      <div className="top-inner">
        <Link href="/" className="brand"><span className="brand-mark"><Barrel size={23} aria-hidden="true" /></span>KegTrack<span>CL</span></Link>
        <div className="account">
          {user.role === 'ADMIN' && <Link className="account-link" href="/equipo">Equipo</Link>}
          <span className="operator">{user.name}</span>
          <form action={logout}><button className="icon-button" aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={19} aria-hidden="true" /></button></form>
        </div>
      </div>
    </header>
    <Navigation />
    <main className="main-content">{children}</main>
  </div>
}
