import Link from 'next/link'
import { ActionForm } from '@/components/form'
import { Empty, Expand, Field, PageTitle } from '@/components/ui'
import { applyTransition, saveVolume } from '@/lib/actions'
import { requireUser } from '@/lib/auth'
import { liters } from '@/lib/domain'
import { prisma } from '@/lib/prisma'

export const metadata = { title: 'Barra' }

export default async function Taproom() {
  await requireUser()
  const taps = await prisma.keg.findMany({ where: { status: 'ON_TAP' }, include: { currentBatch: true }, orderBy: { tapLine: 'asc' } })
  return <>
    <PageTitle title="Barra" detail="Líneas activas y volumen estimado de cada barril." />
    {!taps.length ? <section className="panel"><Empty>No hay barriles pinchados. Escanea un barril lleno para asignar una línea.</Empty></section> :
      <div className="dashboard-grid">
        {taps.map((keg) => <section className="panel tap" key={keg.id}>
          <header className="panel-heading"><span className="line-tag">{keg.tapLine}</span>
            <div className="keg-card-title"><h2>{keg.currentBatch?.beerName}</h2><p>{keg.currentBatch?.style}</p></div>
            <Link className="record-code" href={`/barriles/${keg.kegCode}`}>{keg.kegCode}</Link>
          </header>
          <p className="tap-volume"><strong>{liters(keg.remainingLiters)}</strong> de {keg.sizeLiters} L</p>
          <progress aria-label="Volumen estimado" max={keg.sizeLiters} value={keg.remainingLiters} />
          <Expand label="Ajustar litros estimados">
            <ActionForm action={saveVolume.bind(null, keg.kegCode)} label="Guardar volumen" variant="secondary">
              <input type="hidden" name="version" value={keg.version} />
              <Field label="Litros restantes"><input key={keg.remainingLiters} name="remainingLiters" type="number" min={0} max={keg.sizeLiters} step="0.1" defaultValue={keg.remainingLiters} required /></Field>
            </ActionForm>
          </Expand>
          <ActionForm action={applyTransition.bind(null, keg.kegCode)} label="Barril vacío" variant="danger">
            <input type="hidden" name="version" value={keg.version} /><input type="hidden" name="to" value="DIRTY" />
          </ActionForm>
        </section>)}
      </div>}
  </>
}
