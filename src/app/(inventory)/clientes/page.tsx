import Link from 'next/link'
import { ActionForm } from '@/components/form'
import { Empty, Expand, Field, PageTitle } from '@/components/ui'
import { createClient } from '@/lib/actions'
import { requireUser } from '@/lib/auth'
import { clp, daysInCustody, timeLabel } from '@/lib/domain'
import { prisma } from '@/lib/prisma'

export const metadata = { title: 'Clientes' }

export default async function ClientsPage() {
  const user = await requireUser()
  const clients = await prisma.client.findMany({
    orderBy: { name: 'asc' },
    include: { kegs: { where: { status: 'AT_CLIENT' }, orderBy: { deliveredAt: 'asc' }, include: { currentBatch: true } } },
  })
  return <>
    <PageTitle title="Clientes y comodatos" detail="Custodia, garantías y devoluciones pendientes." />
    {user.role === 'ADMIN' && <Expand label="Registrar un cliente">
      <ActionForm action={createClient} label="Registrar cliente" resetOnSuccess>
        <div className="form-grid">
          <Field label="Nombre o razón social"><input name="name" maxLength={120} required /></Field>
          <Field label="RUT"><input name="rut" placeholder="76.000.000-0" maxLength={20} required /></Field>
          <Field label="Comuna"><input name="comuna" maxLength={80} required /></Field>
          <Field label="Dirección"><input name="address" maxLength={180} required /></Field>
          <Field label="Contacto (opcional)"><input name="contactName" maxLength={100} /></Field>
          <Field label="Teléfono (opcional)"><input name="contactPhone" type="tel" maxLength={40} /></Field>
        </div>
      </ActionForm>
    </Expand>}
    {!clients.length ? <section className="panel"><Empty>Aún no hay clientes registrados.</Empty></section> :
      <div className="dashboard-grid">{clients.map((client) => <section className="panel" key={client.id}>
        <header className="panel-heading"><div><h2>{client.name}</h2><p className="muted">{client.rut}</p></div>
          <span className="muted">{client.kegs.length} {client.kegs.length === 1 ? 'barril' : 'barriles'}</span>
        </header>
        <p>{client.address}, {client.comuna}</p>
        {(client.contactName || client.contactPhone) && <p className="muted">{[client.contactName, client.contactPhone].filter(Boolean).join(' · ')}</p>}
        {client.kegs.length > 0 && <ul className="rows custody">{client.kegs.map((keg) => {
          const days = keg.deliveredAt ? daysInCustody(keg.deliveredAt) : 0
          return <li key={keg.id}><div>
            <Link href={`/barriles/${keg.kegCode}`} className="record-code">{keg.kegCode}</Link>
            <small>{keg.currentBatch?.beerName} · {keg.sizeLiters} L</small>
            {keg.deliveredAt && <small>Entrega {timeLabel(keg.deliveredAt)}</small>}
            {keg.guiaDespacho && <small>Guía {keg.guiaDespacho}</small>}
            {keg.depositClp !== null && <small>Garantía {clp(keg.depositClp)}</small>}
          </div><span className={`row-end ${days > 30 ? 'overdue' : 'muted'}`}>{days} {days === 1 ? 'día' : 'días'}</span></li>
        })}</ul>}
      </section>)}</div>}
  </>
}
