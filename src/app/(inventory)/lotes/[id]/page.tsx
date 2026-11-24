import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/form'
import { Empty, Expand, Field, PageTitle, StatusBadge } from '@/components/ui'
import { saveBatchControl } from '@/lib/actions'
import { requireUser } from '@/lib/auth'
import { availableDeciliters, batchBlock } from '@/lib/batches'
import { batchStatuses, dateLabel, liters, movementLabels, statuses, timeLabel } from '@/lib/domain'
import { readLotTrace } from '@/lib/trace'

export const metadata = { title: 'Trazabilidad del lote' }

export default async function LotPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const lot = await readLotTrace((await params).id)
  if (!lot) notFound()
  const blocked = batchBlock(lot)
  return <>
    <Link className="back-link" href="/lotes">← Lotes</Link>
    <PageTitle title={lot.batchCode} detail={`${lot.beerName} · ${lot.style}`}
      action={<a className="button secondary" href={`/lotes/${lot.id}/csv`}>Descargar CSV</a>} />
    <section className="panel">
      <h2>Control del lote</h2>
      <dl className="facts">
        <div><dt>Estado</dt><dd>{batchStatuses[lot.status]}</dd></div>
        <div><dt>Fecha de llenado</dt><dd>{dateLabel(lot.fillDate)}</dd></div>
        <div><dt>Consumo preferente</dt><dd>{dateLabel(lot.bestBeforeDate)}</dd></div>
        <div><dt>Volumen total</dt><dd>{lot.packagedDeciliters === null ? 'Por confirmar' : liters(lot.packagedDeciliters / 10)}</dd></div>
        <div><dt>Registrado en barriles</dt><dd>{liters(lot.allocatedDeciliters / 10)}</dd></div>
        <div><dt>Saldo para llenar</dt><dd>{lot.packagedDeciliters === null ? 'Por confirmar' : liters(availableDeciliters(lot) / 10)}</dd></div>
      </dl>
      {blocked && <p className="feedback error">{blocked} Se suspenden los llenados, pinchados y entregas nuevas.</p>}
      {lot.packagedDeciliters === null && <p className="muted">Confirma el volumen total. Los llenados anteriores se contabilizaron según la capacidad nominal registrada.</p>}
    </section>
    {user.role === 'ADMIN' && <Expand label="Cambiar estado o volumen del lote">
      <ActionForm action={saveBatchControl.bind(null, lot.id)} label="Guardar control">
        <input type="hidden" name="version" value={lot.controlVersion} />
        <div className="form-grid" key={lot.controlVersion}>
          <Field label="Estado del lote"><select name="status" defaultValue={lot.status}>
            <option value="HOLD">{batchStatuses.HOLD}</option><option value="RELEASED">{batchStatuses.RELEASED}</option>
          </select></Field>
          <Field label="Litros totales del lote"><input name="packagedLiters" type="number" min="0.1" max="100000" step="0.1"
            defaultValue={lot.packagedDeciliters === null ? undefined : lot.packagedDeciliters / 10} /></Field>
          <Field wide label="Motivo"><input name="reason" maxLength={500} required /></Field>
        </div>
      </ActionForm>
    </Expand>}
    <section className="panel">
      <header className="panel-heading"><h2>Barriles con este lote</h2><span className="muted">{lot.kegs.length} en uso</span></header>
      {lot.kegs.length === 0 ? <Empty>Este lote ya no está asignado a ningún barril.</Empty> : <ul className="rows">
        {lot.kegs.map((keg) => <li key={keg.id}>
          <div><Link href={`/barriles/${keg.kegCode}`}>{keg.kegCode}</Link>
            <small>{[keg.currentClient?.name, keg.tapLine && `Línea ${keg.tapLine}`, liters(keg.remainingLiters)].filter(Boolean).join(' · ')}</small>
          </div>
          <StatusBadge status={keg.status} />
        </li>)}
      </ul>}
    </section>
    <section className="panel">
      <header className="panel-heading"><h2>Historial del lote</h2></header>
      {lot.movements.length === 0 ? <Empty>Aún no hay movimientos asociados a este lote.</Empty> : <div className="table-scroll"><table>
        <thead><tr><th scope="col">Barril</th><th scope="col">Fecha y movimiento</th><th scope="col">Ubicación registrada</th><th scope="col">Volumen</th></tr></thead>
        <tbody>{[...lot.movements].reverse().map((movement) => <tr key={movement.id}>
          <td><Link href={`/barriles/${movement.keg.kegCode}`}>{movement.keg.kegCode}</Link></td>
          <td><strong>{movementLabels[movement.kind]}</strong>{movement.correctedBy && <small>Corregido</small>}
            {movement.corrects && <small>Corrige el movimiento #{movement.corrects.kegVersion}</small>}
            <small>{timeLabel(movement.occurredAt)} · {movement.user.name}</small>
            {movement.notes && <small>{movement.notes}</small>}
          </td>
          <td>{movement.fromStatus && movement.fromStatus !== movement.toStatus && `${statuses[movement.fromStatus]} → `}{statuses[movement.toStatus]}
            {movement.client && <small>{movement.client.name} · {movement.client.comuna}</small>}
            {movement.tapLine && <small>Línea {movement.tapLine}</small>}
            {movement.guiaDespacho && <small>Guía {movement.guiaDespacho}</small>}
          </td>
          <td>{liters(movement.remainingLiters)}
            {movement.discardedLiters !== null && <small>{liters(movement.discardedLiters)} descartados</small>}
          </td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {lot.controls.length > 0 && <section className="panel">
      <header className="panel-heading"><h2>Historial de controles</h2></header>
      <ul className="rows">
        {lot.controls.map((control) => <li key={control.id}><div>
          <strong>{batchStatuses[control.status]}{control.packagedDeciliters !== null && ` · ${liters(control.packagedDeciliters / 10)}`}</strong>
          <small>{timeLabel(control.occurredAt)} · {control.user.name}</small><p>{control.notes}</p>
        </div></li>)}
      </ul>
    </section>}
  </>
}
