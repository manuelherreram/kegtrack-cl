import QRCode from 'qrcode'
import Link from 'next/link'
import { PrintButton } from '@/components/print-button'
import { Empty, PageTitle } from '@/components/ui'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pageSize, readRegistry, type SearchParams } from '@/lib/registry'

export const metadata = { title: 'Etiquetas QR' }

export default async function Labels({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser()
  const filters = readRegistry(await searchParams)
  const kegs = await prisma.keg.findMany({
    where: filters.where, orderBy: { kegCode: 'asc' }, skip: (filters.page - 1) * pageSize, take: pageSize,
    select: { kegCode: true, sizeLiters: true },
  })
  const codes = await Promise.all(kegs.map(async (keg) => ({
    ...keg, image: await QRCode.toDataURL(keg.kegCode, { errorCorrectionLevel: 'Q', width: 320, margin: 4 }),
  })))
  return <>
    <div className="no-print">
      <Link href={`/barriles${filters.pageQuery(filters.page)}`} className="back-link">← Volver a barriles</Link>
      <PageTitle title="Etiquetas QR" detail="Papel A4 · Escala 100% · Desactiva los encabezados y pies del navegador."
        action={codes.length > 0 && <PrintButton />} />
    </div>
    {!codes.length ? <Empty>Esta página del registro no tiene etiquetas.</Empty> : <div className="label-sheet">
      {codes.map((item) => <div className="qr-label" key={item.kegCode}>
        <img src={item.image} alt={`Código QR de ${item.kegCode}`} width="128" height="128" />
        <strong>{item.kegCode}</strong><span>{item.sizeLiters} L</span>
      </div>)}
    </div>}
  </>
}
