import type { Keg, Batch, Client } from '@prisma/client'
import { Barrel } from 'lucide-react'
import Link from 'next/link'
import { clp, couplers, daysInCustody, liters, timeLabel } from '@/lib/domain'
import { StatusBadge } from './ui'

type KegWithDetails = Keg & { currentBatch: Batch | null; currentClient: Client | null }

export function KegCard({ keg, linkToHistory = false }: { keg: KegWithDetails; linkToHistory?: boolean }) {
  return <section className="panel keg-card">
    <header className="panel-heading">
      <span className="stat-icon cream"><Barrel size={23} aria-hidden="true" /></span>
      <div className="keg-card-title"><h2>{keg.kegCode}</h2><p>{keg.sizeLiters} L · {couplers[keg.couplerType]}</p></div>
      <StatusBadge status={keg.status} />
    </header>
    <dl className="facts">
      <div><dt>Litros restantes</dt><dd>{liters(keg.remainingLiters)}</dd></div>
      {keg.currentBatch && <div><dt>Lote {keg.currentBatch.batchCode}</dt><dd>{keg.currentBatch.beerName}</dd></div>}
      {keg.tapLine && <div><dt>Línea de barra</dt><dd>{keg.tapLine}</dd></div>}
      {keg.currentClient && <div><dt>Cliente</dt><dd>{keg.currentClient.name}</dd></div>}
      {keg.deliveredAt && <div><dt>Entrega</dt><dd>{timeLabel(keg.deliveredAt)} · {daysInCustody(keg.deliveredAt)} días</dd></div>}
      {keg.guiaDespacho && <div><dt>Guía de despacho</dt><dd>{keg.guiaDespacho}</dd></div>}
      {keg.depositClp !== null && <div><dt>Garantía</dt><dd>{clp(keg.depositClp)}</dd></div>}
      {keg.notes && <div><dt>Notas</dt><dd>{keg.notes}</dd></div>}
    </dl>
    {linkToHistory && <Link className="text-link" href={`/barriles/${keg.kegCode}`}>Ver historial de movimientos</Link>}
  </section>
}
