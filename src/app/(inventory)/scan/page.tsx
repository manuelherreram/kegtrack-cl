import { ActionForm } from '@/components/form'
import { KegCard } from '@/components/keg-card'
import { Scanner } from '@/components/scanner'
import { Expand, Field, PageTitle } from '@/components/ui'
import { applyTransition } from '@/lib/actions'
import { requireUser } from '@/lib/auth'
import { codeFromScan, validActions } from '@/lib/domain'
import { kegDetails } from '@/lib/inventory'
import { prisma } from '@/lib/prisma'
import type { SearchParams } from '@/lib/registry'

export const metadata = { title: 'Escanear barril' }

export default async function ScanPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser()
  const { code: raw } = await searchParams
  const code = typeof raw === 'string' ? codeFromScan(raw) : null
  const keg = code ? await prisma.keg.findUnique({ where: { kegCode: code }, include: kegDetails }) : null
  const options = keg ? validActions(keg.status, user.role) : []
  const [batches, clients] = await Promise.all([
    options.some(({ to }) => to === 'FULL') ? prisma.batch.findMany({
      orderBy: [{ fillDate: 'desc' }, { batchCode: 'asc' }], select: { id: true, batchCode: true, beerName: true },
    }) : [],
    options.some(({ to }) => to === 'AT_CLIENT') ? prisma.client.findMany({
      orderBy: { name: 'asc' }, select: { id: true, name: true, comuna: true },
    }) : [],
  ])
  const scanner = <Scanner initialCode={code ?? ''} />
  return <>
    <PageTitle title="Escanear barril" detail="Lee el QR de la etiqueta o ingresa el código." />
    <div className={`scan-grid${keg ? ' scan-found' : ''}`}>
      {!keg && scanner}
      <div className="scan-results">
        {raw !== undefined && !code && <p className="feedback error" role="alert">Ingresa un código válido, por ejemplo BRL-001.</p>}
        {code && !keg && <p className="feedback error" role="alert">No se encontró el barril {code}.</p>}
        {keg && <>
          <KegCard keg={keg} linkToHistory />
          <section className="action-list" key={keg.id}>
            <h2>Acciones disponibles</h2>
            {!options.length && <p className="empty">No hay movimientos disponibles para este estado y perfil.</p>}
            {options.map(({ to, label }) => <Expand key={to} label={label}>
              {to === 'FULL' && !batches.length ? <p>Crea un lote antes de llenar el barril.</p> :
              to === 'AT_CLIENT' && !clients.length ? <p>Registra un cliente antes de asignar un comodato.</p> :
              <ActionForm action={applyTransition.bind(null, keg.kegCode)} label={label} variant={to === 'RETIRED' ? 'danger' : ''}>
                <input type="hidden" name="to" value={to} />
                <input type="hidden" name="version" value={keg.version} />
                <div className="form-grid">
                  {to === 'FULL' && <Field label="Lote" wide><select name="batchId" required defaultValue="">
                    <option value="" disabled>Selecciona un lote</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batchCode} · {batch.beerName}</option>)}
                  </select></Field>}
                  {to === 'ON_TAP' && <>
                    <Field label="Línea de barra"><input name="tapLine" type="number" min={1} max={999} required /></Field>
                    <Field label="Litros restantes estimados"><input name="remainingLiters" type="number" min={0} max={keg.sizeLiters} step="0.1" defaultValue={keg.remainingLiters} /></Field>
                  </>}
                  {to === 'AT_CLIENT' && <>
                    <Field label="Cliente" wide><select name="clientId" required defaultValue="">
                      <option value="" disabled>Selecciona un cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.comuna}</option>)}
                    </select></Field>
                    <Field label="Guía de despacho (opcional)"><input name="guiaDespacho" maxLength={64} /></Field>
                    <Field label="Garantía en CLP (opcional)"><input name="depositClp" type="number" min={0} max={2147483647} step={1} /></Field>
                  </>}
                  <Field label={to === 'RETIRED' ? 'Motivo de baja' : 'Notas (opcional)'} wide><input name="notes" maxLength={500} required={to === 'RETIRED'} /></Field>
                </div>
              </ActionForm>}
            </Expand>)}
          </section>
        </>}
      </div>
      {keg && scanner}
    </div>
  </>
}
