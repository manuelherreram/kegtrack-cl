import { Prisma, type Keg, type MovementKind, type User } from '@prisma/client'
import { allocateBatch, lockBatch, requireUsableBatch } from './batches'
import { couplers, InputError, sizes, validActions, type KegAction, type Status } from './domain'
import { prisma } from './prisma'

type Tx = Prisma.TransactionClient
type Actor = Pick<User, 'id' | 'role'>
type Change = {
  to: Status
  action?: KegAction
  version: number
  batchId?: string
  clientId?: string
  tapLine?: number
  remainingLiters?: number
  discardedLiters?: number
  guiaDespacho?: string
  depositClp?: number
  notes?: string
}
type KegFields = Pick<Keg, 'sizeLiters' | 'couplerType' | 'notes'>
type KegState = Pick<Keg, 'status' | 'currentBatchId' | 'currentClientId' | 'remainingLiters' |
  'tapLine' | 'deliveredAt' | 'guiaDespacho' | 'depositClp'> & KegFields
type Snapshot = Omit<KegState, 'deliveredAt'> & { deliveredAt: string | null }
type Event = { kind: MovementKind; notes?: string; discardedLiters?: number; correctsId?: string }
type FillRequest = { version: number; liters: number }

export const kegDetails = { currentBatch: true, currentClient: true } satisfies Prisma.KegInclude

function nextState(status: Status, values: Partial<KegState> = {}) {
  return {
    status,
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

function snapshot(keg: Keg): Snapshot {
  const { status, currentBatchId, currentClientId, remainingLiters, tapLine,
    deliveredAt, guiaDespacho, depositClp, sizeLiters, couplerType, notes } = keg
  return {
    status, currentBatchId, currentClientId, remainingLiters, tapLine,
    deliveredAt: deliveredAt?.toISOString() ?? null, guiaDespacho, depositClp, sizeLiters, couplerType, notes,
  }
}

function record(tx: Tx, userId: string, next: Keg, event: Event, previous?: Keg) {
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
      previousState: previous && snapshot(previous),
      ...event,
    },
  })
}

export async function registerKeg(tx: Tx, userId: string, data: Prisma.KegUncheckedCreateInput) {
  const keg = await tx.keg.create({ data })
  await record(tx, userId, keg, { kind: 'REGISTER', notes: keg.notes ?? 'Alta de inventario' })
  return keg
}

const conflict = () => new InputError('El barril cambió mientras estaba abierto. Actualiza y vuelve a intentar.')

function assertVersion(keg: Keg | null, version: number): asserts keg is Keg {
  if (!keg || keg.version !== version) throw conflict()
}

function assertTransition(keg: Keg, actor: Actor, change: Pick<Change, 'version' | 'to' | 'action'>) {
  assertVersion(keg, change.version)
  if (!validActions(keg.status, actor.role).some((option) => option.to === change.to && option.action === change.action)) {
    throw new InputError('La acción no está disponible para este barril o perfil.')
  }
}

function volumeInDeciliters(keg: Keg, value: number | undefined, minimum: number) {
  if (value === undefined || !Number.isInteger(value * 10) || value < minimum || value > keg.sizeLiters) {
    throw new InputError(`Indica un volumen entre ${minimum} y ${keg.sizeLiters} L para ${keg.kegCode}.`)
  }
  return Math.round(value * 10)
}

async function commit(tx: Tx, actor: Actor, keg: Keg, data: Partial<KegState>, event: Event) {
  // PostgreSQL rechecks the version predicate after waiting for a concurrent update.
  const result = await tx.keg.updateMany({
    where: { id: keg.id, version: keg.version },
    data: { ...data, version: { increment: 1 } },
  })
  if (!result.count) throw conflict()
  const next = await tx.keg.findUniqueOrThrow({ where: { id: keg.id } })
  await record(tx, actor.id, next, event, keg)
}

async function fillKegs(
  tx: Tx, actor: Actor, batchId: string | undefined,
  fills: Array<{ keg: Keg; version: number; liters: number | undefined }>, notes?: string,
) {
  const checked = fills.map(({ keg, version, liters }) => {
    assertTransition(keg, actor, { version, to: 'FULL' })
    return { keg, volume: volumeInDeciliters(keg, liters, 0.1) }
  })
  const batch = await allocateBatch(tx, batchId, checked.reduce((total, entry) => total + entry.volume, 0))
  for (const { keg, volume } of checked) {
    await commit(tx, actor, keg, nextState('FULL', { currentBatchId: batch.id, remainingLiters: volume / 10 }),
      { kind: 'FILL', notes })
  }
}

async function saveChange(tx: Tx, actor: Actor, keg: Keg, change: Change) {
  if (change.to === 'FULL' && !change.action) {
    await fillKegs(tx, actor, change.batchId, [{ keg, version: change.version, liters: change.remainingLiters }], change.notes)
    return
  }
  assertTransition(keg, actor, change)
  let data = nextState(change.to)
  const event: Event = { kind: 'STATUS', notes: change.notes }

  switch (change.to) {
    case 'FULL':
      data = nextState('FULL', {
        currentBatchId: keg.currentBatchId,
        remainingLiters: volumeInDeciliters(keg, change.remainingLiters, 0.1) / 10,
      })
      event.kind = 'RETURN_COLD'
      break
    case 'DIRTY':
      if (change.action === 'DISCARD') {
        if (!change.notes?.trim()) throw new InputError('Indica el motivo del descarte.')
        event.kind = 'DISCARD'
        event.discardedLiters = volumeInDeciliters(keg, change.discardedLiters, 0.1) / 10
      } else if (keg.status === 'AT_CLIENT' || keg.status === 'ON_TAP') {
        event.kind = 'RETURN_EMPTY'
      }
      break
    case 'ON_TAP': {
      const line = change.tapLine
      if (line === undefined || !Number.isInteger(line) || line < 1 || line > 999) throw new InputError('Indica una línea de barra entre 1 y 999.')
      const volume = volumeInDeciliters(keg, change.remainingLiters ?? keg.remainingLiters, 0)
      await requireUsableBatch(tx, keg.currentBatchId)
      data = nextState('ON_TAP', { currentBatchId: keg.currentBatchId, tapLine: line, remainingLiters: volume / 10 })
      event.kind = 'TAP'
      break
    }
    case 'AT_CLIENT':
      if (!change.clientId || !await tx.client.findUnique({ where: { id: change.clientId }, select: { id: true } })) {
        throw new InputError('Selecciona un cliente del registro.')
      }
      await requireUsableBatch(tx, keg.currentBatchId)
      data = nextState('AT_CLIENT', {
        currentBatchId: keg.currentBatchId,
        currentClientId: change.clientId,
        remainingLiters: keg.remainingLiters,
        deliveredAt: new Date(),
        guiaDespacho: change.guiaDespacho ?? null,
        depositClp: change.depositClp ?? null,
      })
      event.kind = 'DELIVER'
      break
    case 'RETIRED':
      if (!change.notes?.trim()) throw new InputError('Indica el motivo de la baja.')
      break
  }

  await commit(tx, actor, keg, data, event)
}

export async function transitionKeg(actor: Actor, kegCode: string, change: Change) {
  return prisma.$transaction(async (tx) => {
    const keg = await tx.keg.findUnique({ where: { kegCode } })
    if (!keg) throw new InputError('Barril no encontrado.')
    await saveChange(tx, actor, keg, change)
  })
}

export async function bulkFill(actor: Actor, batchId: string, selected: Map<string, FillRequest>) {
  if (selected.size < 1 || selected.size > 100) throw new InputError('Selecciona de 1 a 100 barriles limpios.')
  return prisma.$transaction(async (tx) => {
    const kegs = await tx.keg.findMany({
      where: { id: { in: [...selected.keys()] } },
      orderBy: { id: 'asc' },
    })
    if (kegs.length !== selected.size) throw new InputError('Uno o más barriles ya no están disponibles.')
    await fillKegs(tx, actor, batchId, kegs.map((keg) => ({ keg, ...selected.get(keg.id)! })), 'Llenado en grupo')
    return kegs.length
  }, { timeout: 20_000 })
}

export async function updateVolume(actor: Actor, kegCode: string, version: number, volume: number) {
  return prisma.$transaction(async (tx) => {
    const keg = await tx.keg.findUnique({ where: { kegCode } })
    assertVersion(keg, version)
    if (keg.status !== 'ON_TAP') throw conflict()
    volumeInDeciliters(keg, volume, 0)
    if (volume === keg.remainingLiters) return
    await commit(tx, actor, keg, { remainingLiters: volume }, { kind: 'VOLUME', notes: 'Ajuste de volumen en barra' })
  })
}

export async function editKeg(actor: Actor, kegCode: string, version: number, fields: KegFields, reason: string) {
  if (actor.role !== 'ADMIN') throw new InputError('Solo administración puede editar la ficha.')
  if (!reason.trim()) throw new InputError('Indica el motivo de la edición.')
  if (!sizes.some((size) => size === fields.sizeLiters) || !Object.hasOwn(couplers, fields.couplerType)) {
    throw new InputError('Selecciona una capacidad y un conector válidos.')
  }
  return prisma.$transaction(async (tx) => {
    const keg = await tx.keg.findUnique({ where: { kegCode } })
    assertVersion(keg, version)
    if (keg.currentBatchId && fields.sizeLiters !== keg.sizeLiters) {
      throw new InputError('Cambia la capacidad cuando el barril esté vacío.')
    }
    if (fields.sizeLiters === keg.sizeLiters && fields.couplerType === keg.couplerType && fields.notes === keg.notes) {
      throw new InputError('No hay cambios para guardar.')
    }
    await commit(tx, actor, keg, fields, { kind: 'EDIT', notes: reason })
  })
}

export async function correctKeg(actor: Actor, kegCode: string, version: number, reason: string) {
  if (actor.role !== 'ADMIN') throw new InputError('Solo administración puede corregir movimientos.')
  if (!reason.trim()) throw new InputError('Indica el motivo de la corrección.')
  return prisma.$transaction(async (tx) => {
    const keg = await tx.keg.findUnique({ where: { kegCode } })
    assertVersion(keg, version)
    const latest = await tx.kegMovement.findUnique({ where: { kegId_kegVersion: { kegId: keg.id, kegVersion: version } } })
    if (!latest?.previousState || latest.kind === 'CORRECTION') {
      throw new InputError('El último movimiento no se puede deshacer.')
    }
    const before = latest.previousState as Snapshot
    if (latest.kind === 'FILL') {
      const batch = await lockBatch(tx, latest.batchId)
      await tx.batch.update({
        where: { id: batch.id },
        data: { allocatedDeciliters: { decrement: Math.round(latest.remainingLiters * 10) } },
      })
    }
    await commit(tx, actor, keg, { ...before, deliveredAt: before.deliveredAt ? new Date(before.deliveredAt) : null },
      { kind: 'CORRECTION', notes: reason, correctsId: latest.id })
  })
}
