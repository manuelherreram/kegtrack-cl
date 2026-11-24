import type { Batch, BatchStatus, Prisma, User } from '@prisma/client'
import { calendarDate, InputError, liters } from './domain'
import { prisma } from './prisma'

type Tx = Prisma.TransactionClient
type LotAvailability = Pick<Batch, 'status' | 'fillDate' | 'bestBeforeDate'>

export function batchBlock(batch: LotAvailability, today = calendarDate()) {
  if (batch.status !== 'RELEASED') return 'El lote está en retención.'
  if (batch.fillDate.toISOString().slice(0, 10) > today) return 'La fecha de llenado del lote aún no ha llegado.'
  if (batch.bestBeforeDate.toISOString().slice(0, 10) < today) return 'El lote superó su fecha de consumo preferente.'
  return null
}

export function availableDeciliters(batch: Pick<Batch, 'packagedDeciliters' | 'allocatedDeciliters'>) {
  return (batch.packagedDeciliters ?? 0) - batch.allocatedDeciliters
}

export async function beerKey(tx: Tx, name: string, style: string) {
  const [row] = await tx.$queryRaw<{ key: string }[]>`
    SELECT jsonb_build_array(lower(btrim(${name})), lower(btrim(${style})))::text AS key
  `
  return row.key
}

export async function lockBatch(tx: Tx, batchId: string | null | undefined) {
  if (!batchId) throw new InputError('Selecciona un lote del registro.')
  // Always lock the lot before writing its kegs. This serializes stock, release
  // changes and dispatch decisions across separate app processes.
  const [batch] = await tx.$queryRaw<Batch[]>`SELECT * FROM "Batch" WHERE "id" = ${batchId} FOR UPDATE`
  if (!batch) throw new InputError('No se encontró el lote.')
  return batch
}

export async function requireUsableBatch(tx: Tx, batchId: string | null | undefined) {
  const batch = await lockBatch(tx, batchId)
  const blocked = batchBlock(batch)
  if (blocked) throw new InputError(blocked)
  return batch
}

export async function allocateBatch(tx: Tx, batchId: string | null | undefined, deciliters: number) {
  const batch = await requireUsableBatch(tx, batchId)
  const available = availableDeciliters(batch)
  if (deciliters > available) throw new InputError(`Quedan ${liters(available / 10)} disponibles para llenar en este lote.`)
  await tx.batch.update({ where: { id: batch.id }, data: { allocatedDeciliters: { increment: deciliters } } })
  return batch
}

export async function controlBatch(
  actor: Pick<User, 'id' | 'role'>,
  batchId: string,
  version: number,
  status: BatchStatus,
  packagedDeciliters: number | undefined,
  notes: string,
) {
  if (actor.role !== 'ADMIN') throw new InputError('Solo administración puede cambiar los controles del lote.')
  if (!notes.trim()) throw new InputError('Indica el motivo del cambio.')
  return prisma.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId)
    if (batch.controlVersion !== version) throw new InputError('Los controles del lote cambiaron. Actualiza y vuelve a intentar.')
    const packaged = packagedDeciliters ?? batch.packagedDeciliters
    if (packaged !== null && (!Number.isInteger(packaged) || packaged <= 0 || packaged < batch.allocatedDeciliters)) {
      throw new InputError(`El volumen total debe cubrir los ${liters(batch.allocatedDeciliters / 10)} ya registrados.`)
    }
    if (status === 'RELEASED') {
      if (packaged === null) throw new InputError('Indica el volumen total antes de liberar el lote.')
      const blocked = batchBlock({ ...batch, status })
      if (blocked) throw new InputError(blocked)
    }
    if (batch.status === status && batch.packagedDeciliters === packaged) throw new InputError('No hay cambios para guardar.')
    await tx.batch.update({
      where: { id: batchId },
      data: { status, packagedDeciliters: packaged, controlVersion: { increment: 1 } },
    })
    await tx.batchControl.create({ data: { batchId, userId: actor.id, status, packagedDeciliters: packaged, notes } })
  })
}
