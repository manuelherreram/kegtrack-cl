import type { Prisma } from '@prisma/client'
import { movementLabels, statuses } from './domain'
import { prisma } from './prisma'

const traceInclude = {
  kegs: { orderBy: { kegCode: 'asc' }, include: { currentClient: { select: { name: true } } } },
  movements: {
    orderBy: [{ occurredAt: 'asc' }, { kegId: 'asc' }, { kegVersion: 'asc' }],
    include: {
      keg: { select: { kegCode: true, status: true, currentBatchId: true } },
      client: { select: { name: true, comuna: true } },
      user: { select: { name: true } },
      correctedBy: { select: { id: true } },
      corrects: { select: { kegVersion: true } },
    },
  },
  controls: {
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    include: { user: { select: { name: true } } },
  },
} satisfies Prisma.BatchInclude

export function readLotTrace(id: string) {
  return prisma.$transaction(
    (tx) => tx.batch.findUnique({ where: { id }, include: traceInclude }),
    { isolationLevel: 'RepeatableRead' },
  )
}

type LotTrace = NonNullable<Awaited<ReturnType<typeof readLotTrace>>>

function csvCell(value: string | number | null) {
  if (value === null) return ''
  if (typeof value === 'number') return String(value).replace('.', ',')
  const safe = /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(value) ? "'" + value : value
  return '"' + safe.replaceAll('"', '""') + '"'
}

export function lotTraceCsv(lot: LotTrace) {
  const rows: Array<Array<string | number | null>> = [[
    'Lote', 'Cerveza', 'Estilo', 'Barril', 'Fecha y hora UTC', 'Versión', 'Movimiento', 'Corregido',
    'Corrige versión', 'Estado anterior', 'Estado posterior', 'Cliente', 'Comuna', 'Línea de barra',
    'Fecha de entrega UTC', 'Guía de despacho', 'Litros anteriores', 'Litros restantes', 'Litros descartados',
    'Con este lote actualmente', 'Estado actual del barril', 'Responsable', 'Notas',
  ]]
  for (const movement of lot.movements) {
    rows.push([
      lot.batchCode, lot.beerName, lot.style, movement.keg.kegCode, movement.occurredAt.toISOString(),
      movement.kegVersion, movementLabels[movement.kind], movement.correctedBy ? 'Sí' : 'No',
      movement.corrects?.kegVersion ?? null, movement.fromStatus ? statuses[movement.fromStatus] : null,
      statuses[movement.toStatus], movement.client?.name ?? null, movement.client?.comuna ?? null,
      movement.tapLine, movement.deliveredAt?.toISOString() ?? null, movement.guiaDespacho,
      movement.previousLiters, movement.remainingLiters, movement.discardedLiters,
      movement.keg.currentBatchId === lot.id ? 'Sí' : 'No', statuses[movement.keg.status],
      movement.user.name, movement.notes,
    ])
  }
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n'
}
