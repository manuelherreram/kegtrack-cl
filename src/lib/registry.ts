import type { Prisma } from '@prisma/client'
import { couplers, statuses, type Status } from './domain'

export const pageSize = 30
export type SearchParams = Record<string, string | string[] | undefined>

export function readRegistry(params: SearchParams) {
  const text = typeof params.q === 'string' ? params.q.trim().slice(0, 80) : ''
  const status = typeof params.estado === 'string' && Object.hasOwn(statuses, params.estado) ? params.estado as Status : ''
  const coupler = typeof params.conector === 'string' && Object.hasOwn(couplers, params.conector) ? params.conector as keyof typeof couplers : ''
  const page = typeof params.p === 'string' && /^[1-9]\d{0,5}$/.test(params.p) ? Number(params.p) : 1
  const where: Prisma.KegWhereInput = {
    ...(status && { status }),
    ...(coupler && { couplerType: coupler }),
    ...(text && { OR: [
      { kegCode: { contains: text, mode: 'insensitive' } },
      { currentBatch: { beerName: { contains: text, mode: 'insensitive' } } },
      { currentBatch: { batchCode: { contains: text, mode: 'insensitive' } } },
      { currentClient: { name: { contains: text, mode: 'insensitive' } } },
    ] }),
  }
  const query = new URLSearchParams()
  if (text) query.set('q', text)
  if (status) query.set('estado', status)
  if (coupler) query.set('conector', coupler)
  function pageQuery(number: number) {
    const next = new URLSearchParams(query)
    if (number > 1) next.set('p', String(number))
    return next.size ? `?${next}` : ''
  }
  return { text, status, coupler, page, where, pageQuery }
}
