import Link from 'next/link'
import { ActionForm } from '@/components/form'
import { Empty, Expand, Field, PageTitle } from '@/components/ui'
import { createBatch, createBeer, fillBatch } from '@/lib/actions'
import { requireUser } from '@/lib/auth'
import { availableDeciliters, batchBlock } from '@/lib/batches'
import { batchStatuses, calendarDate, couplers, dateLabel, liters } from '@/lib/domain'
import { prisma } from '@/lib/prisma'

export const metadata = { title: 'Lotes' }

export default async function BatchesPage() {
  const user = await requireUser()
  const [batches, clean, beers] = await Promise.all([
    prisma.batch.findMany({ orderBy: [{ fillDate: 'desc' }, { batchCode: 'asc' }], include: { _count: { select: { kegs: true } } } }),
    prisma.keg.findMany({ where: { status: 'CLEAN' }, orderBy: { kegCode: 'asc' } }),
    prisma.beer.findMany({ orderBy: [{ name: 'asc' }, { style: 'asc' }] }),
  ])
  const today = calendarDate()
  const available = batches.filter((batch) => !batchBlock(batch, today) && availableDeciliters(batch) > 0)
  return <>
    <PageTitle title="Lotes de cerveza" detail="Registra lotes, controla sus litros y consulta la trazabilidad." />
    {user.role === 'ADMIN' && <>
      <Expand label="Catálogo de cervezas">
        <ActionForm action={createBeer} label="Agregar cerveza" resetOnSuccess>
          <div className="form-grid">
            <Field label="Nombre de la cerveza"><input name="name" maxLength={100} required /></Field>
            <Field label="Estilo"><input name="style" maxLength={100} required /></Field>
          </div>
        </ActionForm>
        {beers.length > 0 && <ul className="rows">
          {beers.map((beer) => <li key={beer.id}><div><strong>{beer.name}</strong><small>{beer.style}</small></div></li>)}
        </ul>}
      </Expand>
      <Expand label="Crear un lote">
        {!beers.length ? <Empty>Agrega una cerveza al catálogo para crear su primer lote.</Empty> :
          <ActionForm action={createBatch} label="Crear lote en retención" resetOnSuccess>
            <div className="form-grid">
              <Field label="Código de lote"><input name="batchCode" placeholder="LOTE-2026-105" maxLength={40} required /></Field>
              <Field label="Cerveza"><select name="beerId" defaultValue="" required>
                <option value="" disabled>Selecciona una cerveza</option>
                {beers.map((beer) => <option key={beer.id} value={beer.id}>{beer.name} · {beer.style}</option>)}
              </select></Field>
              <Field label="Fecha de llenado"><input name="fillDate" type="date" defaultValue={today} required /></Field>
              <Field label="Consumo preferente"><input name="bestBeforeDate" type="date" required /></Field>
              <Field label="Litros totales del lote"><input name="packagedLiters" type="number" min="0.1" max="100000" step="0.1" required /></Field>
            </div>
          </ActionForm>}
      </Expand>
    </>}
    <div className="dashboard-grid">
      <section className="panel">
        <header className="panel-heading"><h2>Llenado en grupo</h2><span className="muted">{clean.length} limpios</span></header>
        {!available.length || !clean.length ? <Empty>{!available.length ? 'Se necesita un lote liberado con litros disponibles.' : 'No hay barriles limpios disponibles.'}</Empty> :
          <ActionForm action={fillBatch} label="Registrar llenado" resetOnSuccess>
            <Field label="Lote de cerveza"><select name="batchId" defaultValue="" required><option value="" disabled>Selecciona un lote</option>
              {available.map((batch) => <option key={batch.id} value={batch.id}>{batch.batchCode} · {batch.beerName} · {liters(availableDeciliters(batch) / 10)} disponibles</option>)}
            </select></Field>
            <div className="check-list" aria-label="Barriles limpios" role="group">
              {clean.map((keg) => <div className="fill-row" key={keg.id}>
                <label><input type="checkbox" name="keg" value={`${keg.id}:${keg.version}`} /> <span><strong>{keg.kegCode}</strong><small>{keg.sizeLiters} L · {couplers[keg.couplerType]}</small></span></label>
                <Field label="Litros llenados"><input aria-label={`Litros llenados en ${keg.kegCode}`} name={`volume-${keg.id}`} type="number" min="0.1" max={keg.sizeLiters} step="0.1" defaultValue={keg.sizeLiters} /></Field>
              </div>)}
            </div>
          </ActionForm>}
      </section>
      <section className="panel">
        <header className="panel-heading"><h2>Lotes registrados</h2></header>
        {!batches.length ? <Empty>Aún no hay lotes registrados.</Empty> : <ul className="rows">
          {batches.map((batch) => <li key={batch.id}>
            <div><Link href={`/lotes/${batch.id}`}>{batch.batchCode} · {batch.beerName}</Link>
              <small>{batchStatuses[batch.status]} · Consumo preferente {dateLabel(batch.bestBeforeDate)}</small>
              {batchBlock(batch, today) && batch.status === 'RELEASED' && <small>{batchBlock(batch, today)}</small>}
            </div>
            <span className="row-end muted">{batch._count.kegs} en uso</span>
          </li>)}
        </ul>}
      </section>
    </div>
  </>
}
