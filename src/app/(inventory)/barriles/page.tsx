import { ArrowLeft, ArrowRight, QrCode, Search } from 'lucide-react'
import Link from 'next/link'
import { ActionForm } from '@/components/form'
import { Empty, Expand, Field, PageTitle, StatusBadge } from '@/components/ui'
import { createKeg } from '@/lib/actions'
import { requireUser } from '@/lib/auth'
import { couplers, liters, sizes, statuses } from '@/lib/domain'
import { kegDetails } from '@/lib/inventory'
import { prisma } from '@/lib/prisma'
import { pageSize, readRegistry, type SearchParams } from '@/lib/registry'

export const metadata = { title: 'Barriles' }

export default async function Registry({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser()
  const filters = readRegistry(await searchParams)
  const total = await prisma.keg.count({ where: filters.where })
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(filters.page, pages)
  const kegs = await prisma.keg.findMany({
    where: filters.where, orderBy: { kegCode: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: kegDetails,
  })

  return <>
    <PageTitle title="Barriles" detail={`${total} ${total === 1 ? 'barril en el registro' : 'barriles en el registro'}`}
      action={kegs.length > 0 && <Link className="button secondary" href={`/barriles/etiquetas${filters.pageQuery(page)}`}><QrCode size={18} aria-hidden="true" />Etiquetas de esta página</Link>} />
    {user.role === 'ADMIN' && <Expand label="Registrar un barril">
      <ActionForm action={createKeg} label="Registrar barril" resetOnSuccess>
        <div className="form-grid">
          <Field label="Código de barril"><input name="kegCode" placeholder="BRL-010" maxLength={32} required /></Field>
          <Field label="Capacidad"><select name="sizeLiters" defaultValue="30">{sizes.map((size) => <option key={size} value={size}>{size} L</option>)}</select></Field>
          <Field label="Conector"><select name="couplerType">{Object.entries(couplers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Notas"><input name="notes" maxLength={500} /></Field>
        </div>
      </ActionForm>
    </Expand>}
    <section className="panel registry">
      <form className="filters" action="/barriles">
        <Field label="Buscar"><input name="q" defaultValue={filters.text} maxLength={80} placeholder="Código, cerveza o cliente" /></Field>
        <Field label="Estado"><select name="estado" defaultValue={filters.status}><option value="">Todos los estados</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Conector"><select name="conector" defaultValue={filters.coupler}><option value="">Todos los conectores</option>{Object.entries(couplers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <button className="button secondary"><Search size={17} aria-hidden="true" />Filtrar</button>
      </form>
      {!kegs.length ? <Empty>No se encontraron barriles.</Empty> : <div className="table-scroll">
        <table className="registry-table">
          <thead><tr><th>Barril</th><th>Estado</th><th>Capacidad / conector</th><th>Lote / destino</th><th>Volumen</th></tr></thead>
          <tbody>{kegs.map((keg) => <tr key={keg.id}>
            <td data-label="Barril"><Link className="record-code" href={`/barriles/${keg.kegCode}`}>{keg.kegCode}</Link></td>
            <td data-label="Estado"><StatusBadge status={keg.status} /></td>
            <td data-label="Capacidad / conector">{keg.sizeLiters} L · {couplers[keg.couplerType]}</td>
            <td data-label="Lote / destino">{keg.currentBatch?.beerName ?? '—'}{keg.currentClient && <small>{keg.currentClient.name}</small>}{keg.tapLine && <small>Línea {keg.tapLine}</small>}</td>
            <td data-label="Volumen">{liters(keg.remainingLiters)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {pages > 1 && <nav className="pagination" aria-label="Páginas del registro">
        {page > 1 && <Link href={`/barriles${filters.pageQuery(page - 1)}`}><ArrowLeft size={16} aria-hidden="true" />Anterior</Link>}
        <span>Página {page} de {pages}</span>
        {page < pages && <Link href={`/barriles${filters.pageQuery(page + 1)}`}>Siguiente<ArrowRight size={16} aria-hidden="true" /></Link>}
      </nav>}
    </section>
  </>
}
