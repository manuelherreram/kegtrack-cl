import { currentUser } from '@/lib/auth'
import { lotTraceCsv, readLotTrace } from '@/lib/trace'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await currentUser()) return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  const lot = await readLotTrace((await params).id)
  if (!lot) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const filename = lot.batchCode.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
  return new Response(lotTraceCsv(lot), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="lote-${filename}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
