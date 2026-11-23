import { ArrowRight, Beer, CircleAlert, Package, ScanLine, Snowflake, Truck } from 'lucide-react'
import Link from 'next/link'
import { Empty, PageTitle, StatusBadge } from '@/components/ui'
import { requireUser } from '@/lib/auth'
import { daysInCustody, liters, statuses, type Status } from '@/lib/domain'
import { prisma } from '@/lib/prisma'

export default async function Dashboard() {
  await requireUser()
  const [counts, taps, custody] = await Promise.all([
    prisma.keg.groupBy({ by: ['status'], _count: true }),
    prisma.keg.findMany({ where: { status: 'ON_TAP' }, include: { currentBatch: true }, orderBy: { tapLine: 'asc' } }),
    prisma.keg.findMany({
      where: { status: 'AT_CLIENT', deliveredAt: { lt: new Date(Date.now() - 29 * 86_400_000) } },
      include: { currentClient: true }, orderBy: { deliveredAt: 'asc' },
    }),
  ])
  const count = (status: Status) => counts.find((row) => row.status === status)?._count ?? 0
  const inInventory = counts.reduce((sum, row) => sum + (row.status === 'RETIRED' ? 0 : row._count), 0)
  const overdue = custody.flatMap((keg) => {
    const days = keg.deliveredAt ? daysInCustody(keg.deliveredAt) : 0
    return days > 30 ? [{ ...keg, days }] : []
  })
  const cards = [
    { label: 'Barriles activos', value: inInventory, href: '/barriles', icon: Package, color: 'cream' },
    { label: 'En cámara de frío', value: count('FULL'), href: '/barriles?estado=FULL', icon: Snowflake, color: 'blue' },
    { label: 'Pinchados en barra', value: count('ON_TAP'), href: '/barra', icon: Beer, color: 'amber' },
    { label: 'En cliente', value: count('AT_CLIENT'), href: '/clientes', icon: Truck, color: 'green' },
  ]
  return <>
    <PageTitle title="Resumen de operación" detail="Inventario de barriles, líneas de barra y comodatos." action={<Link className="button" href="/scan"><ScanLine size={19} aria-hidden="true" />Escanear barril</Link>} />
    <div className="stats">
      {cards.map(({ label, value, href, icon: Icon, color }) =>
        <Link className="stat" key={label} href={href}>
          <span className={`stat-icon ${color}`}><Icon size={20} aria-hidden="true" /></span>
          <strong>{value}</strong><span>{label}</span>
        </Link>
      )}
    </div>
    <div className="dashboard-grid">
      <section className="panel">
        <header className="panel-heading"><h2>Barra activa</h2><Link href="/barra">Ver barra <ArrowRight size={15} aria-hidden="true" /></Link></header>
        {taps.length === 0 ? <Empty>No hay barriles pinchados.</Empty> : <ul className="rows">{taps.map((keg) =>
          <li key={keg.id}><span className="line-tag">{keg.tapLine}</span>
            <div><Link href={`/barriles/${keg.kegCode}`}>{keg.currentBatch?.beerName}</Link><small>{keg.kegCode}</small></div>
            <span className="row-end">{liters(keg.remainingLiters)}</span>
          </li>
        )}</ul>}
      </section>
      <section className="panel">
        <header className="panel-heading"><h2>Comodatos de más de 30 días</h2><Link href="/clientes">Ver clientes <ArrowRight size={15} aria-hidden="true" /></Link></header>
        {overdue.length === 0 ? <Empty>No hay comodatos con más de 30 días.</Empty> : <ul className="rows">{overdue.slice(0, 8).map((keg) =>
          <li key={keg.id}><span className="stat-icon amber"><CircleAlert size={18} aria-hidden="true" /></span>
            <div><Link href={`/barriles/${keg.kegCode}`}>{keg.currentClient?.name}</Link><small>{keg.kegCode}</small></div>
            <span className="row-end overdue">{keg.days} días</span>
          </li>
        )}</ul>}
      </section>
    </div>
    <section className="panel">
      <header className="panel-heading"><h2>Inventario por estado</h2></header>
      <ul className="status-grid">{(Object.keys(statuses) as Status[]).map((status) =>
        <li key={status}><Link href={`/barriles?estado=${status}`}><StatusBadge status={status} /><strong>{count(status)}</strong></Link></li>
      )}</ul>
    </section>
  </>
}
