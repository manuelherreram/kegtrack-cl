import { ActionForm } from '@/components/form'
import { Empty, Expand, Field, PageTitle } from '@/components/ui'
import { createBatch, fillBatch } from '@/lib/actions'
import { requireUser } from '@/lib/auth'
import { calendarDate, couplers, dateLabel } from '@/lib/domain'
import { prisma } from '@/lib/prisma'

export const metadata = { title: 'Lotes' }

export default async function BatchesPage() {
  const user = await requireUser()
  const [batches, clean] = await Promise.all([
    prisma.batch.findMany({ orderBy: [{ fillDate: 'desc' }, { batchCode: 'asc' }], include: { _count: { select: { kegs: true } } } }),
    prisma.keg.findMany({ where: { status: 'CLEAN' }, orderBy: { kegCode: 'asc' } }),
  ])
  return <>
    <PageTitle title="Lotes de cerveza" detail="Registra lotes y llena barriles sanitizados en grupo." />
    {user.role === 'ADMIN' && <Expand label="Crear un lote">
      <ActionForm action={createBatch} label="Crear lote" resetOnSuccess>
        <div className="form-grid">
          <Field label="Código de lote"><input name="batchCode" placeholder="LOTE-2026-105" maxLength={40} required /></Field>
          <Field label="Cerveza"><input name="beerName" maxLength={100} required /></Field>
          <Field label="Estilo"><input name="style" maxLength={100} required /></Field>
          <Field label="Fecha de llenado"><input name="fillDate" type="date" defaultValue={calendarDate()} required /></Field>
          <Field label="Consumo preferente"><input name="bestBeforeDate" type="date" required /></Field>
        </div>
      </ActionForm>
    </Expand>}
    <div className="dashboard-grid">
      <section className="panel">
        <header className="panel-heading"><h2>Llenado en grupo</h2><span className="muted">{clean.length} limpios</span></header>
        {!batches.length || !clean.length ? <Empty>{!batches.length ? 'Crea un lote para empezar.' : 'No hay barriles limpios disponibles.'}</Empty> :
          <ActionForm action={fillBatch} label="Registrar llenado" resetOnSuccess>
            <Field label="Lote de cerveza"><select name="batchId" defaultValue="" required><option disabled value="">Selecciona un lote</option>
              {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batchCode} · {batch.beerName}</option>)}
            </select></Field>
            <div className="check-list" aria-label="Barriles limpios" role="group">
              {clean.map((keg) => <label key={keg.id}><input type="checkbox" name="keg" value={`${keg.id}:${keg.version}`} />
                <strong>{keg.kegCode}</strong><span>{keg.sizeLiters} L · {couplers[keg.couplerType]}</span></label>)}
            </div>
          </ActionForm>}
      </section>
      <section className="panel">
        <header className="panel-heading"><h2>Lotes registrados</h2></header>
        {!batches.length ? <Empty>Aún no hay lotes registrados.</Empty> : <ul className="rows">
          {batches.map((batch) => <li key={batch.id}>
            <div><strong>{batch.beerName}</strong><small>{batch.batchCode} · {batch.style}</small>
              <small>Llenado {dateLabel(batch.fillDate)} · Consumo preferente {dateLabel(batch.bestBeforeDate)}</small></div>
            <span className="row-end muted">{batch._count.kegs} {batch._count.kegs === 1 ? 'barril' : 'barriles'}</span>
          </li>)}
        </ul>}
      </section>
    </div>
  </>
}
