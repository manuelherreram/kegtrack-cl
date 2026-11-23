import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { KegCard } from '@/components/keg-card'
import { PageTitle } from '@/components/ui'
import { requireUser } from '@/lib/auth'
import { clp, liters, statuses, timeLabel } from '@/lib/domain'
import { kegDetails } from '@/lib/inventory'
import { prisma } from '@/lib/prisma'

export const metadata = { title: 'Historial del barril' }

export default async function KegHistory({ params }: { params: Promise<{ code: string }> }) {
  await requireUser()
  const { code } = await params
  const keg = await prisma.keg.findUnique({
    where: { kegCode: code.toUpperCase() },
    include: {
      ...kegDetails,
      movements: { orderBy: { kegVersion: 'desc' }, include: { user: { select: { name: true } }, batch: true, client: true } },
    },
  })
  if (!keg) notFound()
  return <>
    <Link href="/barriles" className="back-link">← Barriles</Link>
    <PageTitle title="Ficha del barril" action={<Link className="button" href={`/scan?code=${keg.kegCode}`}><ScanLine size={18} aria-hidden="true" />Operar barril</Link>} />
    <KegCard keg={keg} />
    <section className="panel history">
      <header className="panel-heading"><h2>Historial de movimientos</h2></header>
      <ol className="rows">
        {keg.movements.map((movement) => <li key={movement.id}>
          <div>
            <strong>{movement.fromStatus && movement.fromStatus !== movement.toStatus ? `${statuses[movement.fromStatus]} → ` : ''}{statuses[movement.toStatus]}</strong>
            <small>{timeLabel(movement.occurredAt)} · {movement.user.name}</small>
            <p>{[
              movement.batch?.batchCode, movement.client?.name, movement.tapLine && `Línea ${movement.tapLine}`,
              movement.deliveredAt && `Entrega ${timeLabel(movement.deliveredAt)}`,
              movement.guiaDespacho && `Guía ${movement.guiaDespacho}`,
              movement.depositClp !== null && `Garantía ${clp(movement.depositClp)}`,
              movement.previousLiters !== null && movement.previousLiters !== movement.remainingLiters
                ? `${liters(movement.previousLiters)} → ${liters(movement.remainingLiters)}`
                : liters(movement.remainingLiters),
            ].filter(Boolean).join(' · ')}</p>
            {movement.notes && <p>{movement.notes}</p>}
          </div>
        </li>)}
      </ol>
    </section>
  </>
}
