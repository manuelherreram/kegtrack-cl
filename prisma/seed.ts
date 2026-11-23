import type { Prisma } from '@prisma/client'
import { calendarDate, formatRut } from '../src/lib/domain'
import { registerKeg } from '../src/lib/inventory'
import { prisma } from '../src/lib/prisma'

function dayOffset(offset: number) {
  const today = new Date(calendarDate())
  today.setUTCDate(today.getUTCDate() + offset)
  return today
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
  await prisma.$transaction(async (tx) => {
    // Serialize opt-in seed runs to keep the demo inventory and audit records consistent.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(273504481)`
    const actor = await tx.user.findUnique({ where: { email } })
    if (!actor?.active || actor.role !== 'ADMIN') throw new Error('Bootstrap the administrator before loading demo data.')

    const client = await tx.client.upsert({
      where: { rut: formatRut('76000000-0')! }, update: {},
      create: { name: 'Bar Quebrada (demo)', rut: formatRut('76000000-0')!, comuna: 'Providencia', address: 'Dirección de ejemplo', contactName: 'Contacto demo' },
    })
    const secondRut = formatRut('76000001-9')!
    await tx.client.upsert({
      where: { rut: secondRut }, update: {},
      create: { name: 'Taproom Bosque (demo)', rut: secondRut, comuna: 'Ñuñoa', address: 'Dirección de ejemplo' },
    })
    const ipa = await tx.batch.upsert({
      where: { batchCode: 'DEMO-IPA' }, update: {},
      create: { batchCode: 'DEMO-IPA', beerName: 'Cordillera Hazy IPA', style: 'Hazy IPA', fillDate: dayOffset(-50), bestBeforeDate: dayOffset(80) },
    })
    const stout = await tx.batch.upsert({
      where: { batchCode: 'DEMO-STOUT' }, update: {},
      create: { batchCode: 'DEMO-STOUT', beerName: 'Patagonia Oatmeal Stout', style: 'Oatmeal Stout', fillDate: dayOffset(-7), bestBeforeDate: dayOffset(120) },
    })
    const kegs: Prisma.KegUncheckedCreateInput[] = [
      { kegCode: 'BRL-001', sizeLiters: 30, couplerType: 'G', status: 'ON_TAP', tapLine: 1, currentBatchId: ipa.id, remainingLiters: 18.5 },
      { kegCode: 'BRL-002', sizeLiters: 30, couplerType: 'G', status: 'ON_TAP', tapLine: 2, currentBatchId: stout.id, remainingLiters: 27 },
      { kegCode: 'BRL-003', sizeLiters: 30, couplerType: 'G', status: 'FULL', currentBatchId: ipa.id, remainingLiters: 30 },
      { kegCode: 'BRL-004', sizeLiters: 50, couplerType: 'S', status: 'AT_CLIENT', currentBatchId: ipa.id, currentClientId: client.id, deliveredAt: dayOffset(-36), remainingLiters: 50, guiaDespacho: 'GD-DEMO-41', depositClp: 60000 },
      { kegCode: 'BRL-005', sizeLiters: 20, couplerType: 'A', status: 'CLEAN' },
      { kegCode: 'BRL-006', sizeLiters: 30, couplerType: 'G', status: 'CLEAN' },
      { kegCode: 'BRL-007', sizeLiters: 30, couplerType: 'G', status: 'DIRTY' },
      { kegCode: 'BRL-008', sizeLiters: 19, couplerType: 'BALL_LOCK', status: 'MAINTENANCE' },
    ]
    for (const keg of kegs) {
      if (!await tx.keg.findUnique({ where: { kegCode: keg.kegCode }, select: { id: true } })) {
        await registerKeg(tx, actor.id, { ...keg, notes: 'Inventario de demostración' })
      }
    }
  }, { timeout: 20_000 })
  console.log('Demo inventory ready.')
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
