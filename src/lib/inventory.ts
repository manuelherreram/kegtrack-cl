import { Prisma, type Keg, type User } from '@prisma/client'
import { validActions, type Status } from './domain'
import { prisma } from './prisma'

export class InputError extends Error {}

type Tx = Prisma.TransactionClient
type Actor = Pick<User, 'id' | 'role'>
type Change = {
  to: Status
  version: number
  batchId?: string
  clientId?: string
  tapLine?: number
  remainingLiters?: number
  guiaDespacho?: string
  depositClp?: number
  notes?: string
}

export const kegDetails = { currentBatch: true, currentClient: true } satisfies Prisma.KegInclude

function nextState(to: Status, values: Partial<Keg> = {}) {
  return {
    status: to,
    currentBatchId: null,
    currentClientId: null,
    remainingLiters: 0,
    tapLine: null,
    deliveredAt: null,
    guiaDespacho: null,
    depositClp: null,
    ...values,
  }
}

function record(tx: Tx, userId: string, next: Keg, previous?: Keg, notes?: string) {
  return tx.kegMovement.create({
    data: {
      kegId: next.id,
      userId,
      kegVersion: next.version,
      fromStatus: previous?.status,
      toStatus: next.status,
      batchId: next.currentBatchId ?? previous?.currentBatchId,
      clientId: next.currentClientId ?? previous?.currentClientId,
      previousLiters: previous?.remainingLiters,
      remainingLiters: next.remainingLiters,
      tapLine: next.tapLine ?? previous?.tapLine,
      deliveredAt: next.deliveredAt ?? previous?.deliveredAt,
      guiaDespacho: next.guiaDespacho ?? previous?.guiaDespacho,
      depositClp: next.depositClp ?? previous?.depositClp,
      notes,
    },
  })
}

export async function registerKeg(tx: Tx, userId: string, data: Prisma.KegUncheckedCreateInput) {
  const keg = await tx.keg.create({ data })
  await record(tx, userId, keg, undefined, keg.notes ?? 'Alta de inventario')
  return keg
}

const conflict = () => new InputError('El barril cambió mientras estaba abierto. Actualiza y vuelve a intentar.')

async function saveChange(tx: Tx, actor: Actor, keg: Keg, change: Change) {
  if (keg.version !== change.version) throw conflict()
  if (!validActions(keg.status, actor.role).some((option) => option.to === change.to)) {
    throw new InputError('La acción no está disponible para este barril o perfil.')
  }
  let data = nextState(change.to)

  switch (change.to) {
    case 'FULL':
      if (!change.batchId || !await tx.batch.findUnique({ where: { id: change.batchId }, select: { id: true } })) {
        throw new InputError('Selecciona un lote vigente en el registro.')
      }
      data = nextState('FULL', { currentBatchId: change.batchId, remainingLiters: keg.sizeLiters })
      break
    case 'ON_TAP': {
      const line = change.tapLine
      const volume = change.remainingLiters ?? keg.remainingLiters
      if (line === undefined || !Number.isInteger(line) || line < 1 || line > 999) throw new InputError('Indica una línea de barra entre 1 y 999.')
      if (!Number.isFinite(volume) || volume < 0 || volume > keg.sizeLiters) throw new InputError('Revisa los litros estimados.')
      data = nextState('ON_TAP', { currentBatchId: keg.currentBatchId, tapLine: line, remainingLiters: volume })
      break
    }
    case 'AT_CLIENT':
      if (!change.clientId || !await tx.client.findUnique({ where: { id: change.clientId }, select: { id: true } })) {
        throw new InputError('Selecciona un cliente del registro.')
      }
      data = nextState('AT_CLIENT', {
        currentBatchId: keg.currentBatchId,
        currentClientId: change.clientId,
        remainingLiters: keg.remainingLiters,
        deliveredAt: new Date(),
        guiaDespacho: change.guiaDespacho ?? null,
        depositClp: change.depositClp ?? null,
      })
      break
    case 'RETIRED':
      if (!change.notes?.trim()) throw new InputError('Indica el motivo de la baja.')
      break
  }

  // PostgreSQL rechecks the version predicate after waiting for a concurrent update.
  const result = await tx.keg.updateMany({
    where: { id: keg.id, version: change.version },
    data: { ...data, version: { increment: 1 } },
  })
  if (!result.count) throw conflict()
  const next = await tx.keg.findUniqueOrThrow({ where: { id: keg.id } })
  await record(tx, actor.id, next, keg, change.notes)
}

export async function transitionKeg(actor: Actor, kegCode: string, change: Change) {
  return prisma.$transaction(async (tx) => {
    const keg = await tx.keg.findUnique({ where: { kegCode } })
    if (!keg) throw new InputError('Barril no encontrado.')
    await saveChange(tx, actor, keg, change)
  })
}

export async function bulkFill(actor: Actor, batchId: string, selected: Map<string, number>) {
  return prisma.$transaction(async (tx) => {
    const kegs = await tx.keg.findMany({
      where: { id: { in: [...selected.keys()] } },
      orderBy: { id: 'asc' },
    })
    if (kegs.length !== selected.size) throw new InputError('Uno o más barriles ya no están disponibles.')
    for (const keg of kegs) {
      await saveChange(tx, actor, keg, {
        version: selected.get(keg.id)!,
        to: 'FULL',
        batchId,
        notes: 'Llenado en grupo',
      })
    }
    return kegs.length
  }, { timeout: 20_000 })
}

export async function updateVolume(actor: Actor, kegCode: string, version: number, volume: number) {
  return prisma.$transaction(async (tx) => {
    const keg = await tx.keg.findUnique({ where: { kegCode } })
    if (!keg || keg.version !== version || keg.status !== 'ON_TAP') throw conflict()
    if (!Number.isFinite(volume) || volume < 0 || volume > keg.sizeLiters) throw new InputError('Revisa los litros estimados.')
    if (volume === keg.remainingLiters) return
    const result = await tx.keg.updateMany({
      where: { id: keg.id, version },
      data: { remainingLiters: volume, version: { increment: 1 } },
    })
    if (!result.count) throw conflict()
    const next = await tx.keg.findUniqueOrThrow({ where: { id: keg.id } })
    await record(tx, actor.id, next, keg, 'Ajuste de volumen en barra')
  })
}
