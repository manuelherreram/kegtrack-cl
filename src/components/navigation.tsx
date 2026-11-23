'use client'

import { Archive, Beer, Boxes, LayoutDashboard, ScanLine, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const items = [
  { href: '/', label: 'Resumen', icon: LayoutDashboard },
  { href: '/barriles', label: 'Barriles', icon: Archive },
  { href: '/scan', label: 'Escanear', icon: ScanLine },
  { href: '/lotes', label: 'Lotes', icon: Boxes },
  { href: '/barra', label: 'Barra', icon: Beer },
  { href: '/clientes', label: 'Clientes', icon: Users },
]

export function Navigation() {
  const pathname = usePathname()
  return <nav className="navigation no-print" aria-label="Principal">
    {items.map(({ href, label, icon: Icon }) => {
      const active = pathname === href || (href !== '/' && pathname.startsWith(href + '/'))
      return <Link key={href} href={href} aria-current={active ? 'page' : undefined}>
        <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
      </Link>
    })}
  </nav>
}
