import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { ActionForm } from '@/components/form'
import { KegCard } from '@/components/keg-card'
import { RetireKeg } from '@/components/retire-keg'
import { Expand, Field, PageTitle } from '@/components/ui'
import { saveKegDetails, undoKegMovement } from '@/lib/actions'
import { requireUser } from '@/lib/auth'
import { clp, couplers, liters, movementLabels, sizes, statuses, timeLabel, validActions } from '@/lib/domain'
import { kegDetails } from '@/lib/inventory'
import { prisma } from '@/lib/prisma'

export const metadata = { title: 'Historial del barril' }

export default async function KegHistory({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser()
  const { code } = await params
  const keg = await prisma.keg.findUnique({
    where: { kegCode: code.toUpperCase() },
    include: {
      ...kegDetails,
      movements: { orderBy: { kegVersion: 'desc' }, include: {
        user: { select: { name: true } }, batch: true, client: true,
        correctedBy: { select: { id: true } }, corrects: { select: { kegVersion: true } },
      } },
    },
  })
  if (!keg) notFound()
  const canRetire = validActions(keg.status, user.role).some(({ to }) => to === 'RETIRED')
  const latest = keg.movements[0]
  const canUndo = latest?.previousState && latest.kind !== 'CORRECTION'
  return <>
    <Link href="/barriles" className="back-link">← Barriles</Link>
    <PageTitle title="Ficha del barril" action={keg.status !== 'RETIRED' && <Link className="button" href={`/scan?code=${keg.kegCode}`}><ScanLine size={18} aria-hidden="true" />Operar barril</Link>} />
    <KegCard keg={keg} />
    {user.role === 'ADMIN' && <>
      <Expand label="Editar ficha">
        <ActionForm action={saveKegDetails.bind(null, keg.kegCode)} label="Guardar ficha">
          <input type="hidden" name="version" value={keg.version} />
          <div className="form-grid" key={keg.version}>
            <Field label="Capacidad"><select name="sizeLiters" defaultValue={keg.sizeLiters}>
              {(keg.currentBatchId ? [keg.sizeLiters] : sizes).map((size) => <option key={size} value={size}>{size} L</option>)}
            </select></Field>
            <Field label="Conector"><select name="couplerType" defaultValue={keg.couplerType}>
              {Object.entries(couplers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></Field>
            <Field wide label="Notas de la ficha"><input name="notes" maxLength={500} defaultValue={keg.notes ?? ''} /></Field>
            <Field wide label="Motivo de la edición"><input name="reason" maxLength={500} required /></Field>
          </div>
        </ActionForm>
      </Expand>
      {canUndo && <Expand label="Deshacer último movimiento">
        <p>Usa esta acción si el registro fue incorrecto. Se restaurará la ficha anterior y quedará constancia en el historial.</p>
        <p><strong>#{latest.kegVersion} · {movementLabels[latest.kind]}</strong> · {timeLabel(latest.occurredAt)}</p>
        <ActionForm action={undoKegMovement.bind(null, keg.kegCode)} label="Registrar corrección" variant="danger">
          <input type="hidden" name="version" value={keg.version} />
          <Field label="Motivo de la corrección"><input key={keg.version} name="reason" maxLength={500} required /></Field>
        </ActionForm>
      </Expand>}
    </>}
    {canRetire && <RetireKeg kegCode={keg.kegCode} version={keg.version} />}
    {user.role === 'ADMIN' && !canRetire && keg.status !== 'RETIRED' &&
      <p className="muted">La baja está disponible para barriles vacíos o en mantención.</p>}
    <section className="panel history">
      <header className="panel-heading"><h2>Historial de movimientos</h2></header>
      <ol className="rows">
        {keg.movements.map((movement) => <li key={movement.id}>
          <div>
            <strong>{movement.fromStatus && movement.fromStatus !== movement.toStatus ? `${statuses[movement.fromStatus]} → ` : ''}{statuses[movement.toStatus]}</strong>
            <small>#{movement.kegVersion} · {movementLabels[movement.kind]} · {timeLabel(movement.occurredAt)} · {movement.user.name}</small>
            {movement.correctedBy && <small>Corregido</small>}
            {movement.corrects && <small>Corrige el movimiento #{movement.corrects.kegVersion}</small>}
            <p>{[
              movement.batch?.batchCode, movement.client?.name, movement.tapLine && `Línea ${movement.tapLine}`,
              movement.deliveredAt && `Entrega ${timeLabel(movement.deliveredAt)}`,
              movement.guiaDespacho && `Guía ${movement.guiaDespacho}`,
              movement.depositClp !== null && `Garantía ${clp(movement.depositClp)}`,
              movement.discardedLiters !== null && `${liters(movement.discardedLiters)} descartados`,
              movement.previousLiters !== null && movement.previousLiters !== movement.remainingLiters
                ? `${liters(movement.previousLiters)} → ${liters(movement.remainingLiters)}`
                : liters(movement.remainingLiters),
            ].filter(Boolean).join(' · ')}</p>
            {movement.notes && <p>{movement.notes}</p>}
            {movement.batch && <Link href={`/lotes/${movement.batch.id}`}>Ver lote {movement.batch.batchCode}</Link>}
          </div>
        </li>)}
      </ol>
    </section>
  </>
}
