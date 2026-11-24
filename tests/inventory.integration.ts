import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, test } from 'node:test'
import { bulkFill, registerKeg, transitionKeg, updateVolume } from '../src/lib/inventory'
import { prisma } from '../src/lib/prisma'

if (process.env.KEGTRACK_TEST_DB !== '1') throw new Error('Use a disposable migrated database and set KEGTRACK_TEST_DB=1.')

after(() => prisma.$disconnect())

test('guards concurrent movement, atomic bulk fill, tap uniqueness and append-only history', async () => {
  const scope = `QA-${randomBytes(5).toString('hex').toUpperCase()}`
  const actor = await prisma.user.create({ data: { email: `${scope.toLowerCase()}@example.test`, name: 'Integration test', passwordHash: 'test-only', role: 'STAFF' } })
  const admin = await prisma.user.create({ data: { email: `${scope.toLowerCase()}-admin@example.test`, name: 'Integration admin', passwordHash: 'test-only', role: 'ADMIN' } })
  const batch = await prisma.batch.create({
    data: { batchCode: scope, beerName: 'Integration IPA', style: 'IPA', fillDate: new Date('2026-01-01'), bestBeforeDate: new Date('2027-01-01') },
  })
  const client = await prisma.client.create({
    data: { name: scope, rut: scope, comuna: 'Ñuñoa', address: 'Integration test' },
  })
  const [a, b, c] = await prisma.$transaction(async (tx) => {
    const kegs = []
    for (const tail of ['A', 'B', 'C']) {
      const code = `${scope}-${tail}`
      kegs.push(await registerKeg(tx, actor.id, { id: code, kegCode: code, sizeLiters: 30, couplerType: 'G' }))
    }
    return kegs
  })

  const race = await Promise.allSettled([
    transitionKeg(actor, a.kegCode, { to: 'CLEAN', version: 0 }),
    transitionKeg(actor, a.kegCode, { to: 'CLEAN', version: 0 }),
  ])
  assert.equal(race.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(await prisma.kegMovement.count({ where: { kegId: a.id } }), 2)

  await transitionKeg(actor, b.kegCode, { to: 'CLEAN', version: 0 })
  await assert.rejects(bulkFill(actor, batch.id, new Map([[a.id, 1], [b.id, 0]])), /cambió/)
  assert.equal((await prisma.keg.findUniqueOrThrow({ where: { id: a.id } })).status, 'CLEAN')
  assert.equal(await prisma.kegMovement.count({ where: { kegId: a.id } }), 2)

  assert.equal(await bulkFill(actor, batch.id, new Map([[a.id, 1], [b.id, 1]])), 2)
  const usedLines = await prisma.keg.findMany({ where: { tapLine: { not: null } }, select: { tapLine: true } })
  const line = Array.from({ length: 999 }, (_, i) => i + 1).find((n) => !usedLines.some(({ tapLine }) => tapLine === n))!
  const tapRace = await Promise.allSettled([
    transitionKeg(actor, a.kegCode, { to: 'ON_TAP', tapLine: line, version: 2 }),
    transitionKeg(actor, b.kegCode, { to: 'ON_TAP', tapLine: line, version: 2 }),
  ])
  assert.equal(tapRace.filter((item) => item.status === 'fulfilled').length, 1)
  const [tapped, full] = tapRace[0].status === 'fulfilled' ? [a, b] : [b, a]
  await assert.rejects(transitionKeg(admin, tapped.kegCode, { to: 'RETIRED', version: 3, notes: 'Retiro' }), /perfil/)
  await assert.rejects(transitionKeg(admin, full.kegCode, { to: 'RETIRED', version: 2, notes: 'Retiro' }), /perfil/)
  await updateVolume(actor, tapped.kegCode, 3, 14.5)
  await transitionKeg(actor, tapped.kegCode, { to: 'DIRTY', version: 4 })
  const kicked = await prisma.kegMovement.findUniqueOrThrow({ where: { kegId_kegVersion: { kegId: tapped.id, kegVersion: 5 } } })
  assert.deepEqual([kicked.batchId, kicked.tapLine, kicked.previousLiters, kicked.remainingLiters], [batch.id, line, 14.5, 0])

  await transitionKeg(actor, full.kegCode, { to: 'AT_CLIENT', clientId: client.id, version: 2, guiaDespacho: 'GD-7', depositClp: 23000 })
  await transitionKeg(actor, full.kegCode, { to: 'DIRTY', version: 3 })
  const returned = await prisma.kegMovement.findUniqueOrThrow({ where: { kegId_kegVersion: { kegId: full.id, kegVersion: 4 } } })
  assert.deepEqual([returned.userId, returned.batchId, returned.clientId, returned.guiaDespacho, returned.depositClp], [actor.id, batch.id, client.id, 'GD-7', 23000])
  assert.ok(returned.deliveredAt)
  const empty = await prisma.keg.findUniqueOrThrow({ where: { id: full.id } })
  assert.deepEqual([empty.currentBatchId, empty.currentClientId, empty.guiaDespacho, empty.depositClp, empty.deliveredAt], [null, null, null, null, null])
  await assert.rejects(transitionKeg(actor, c.kegCode, { to: 'MAINTENANCE', version: 0 }), /perfil/)
  await assert.rejects(transitionKeg(actor, full.kegCode, { to: 'RETIRED', version: 4, notes: 'Retiro' }), /perfil/)
  await assert.rejects(transitionKeg(admin, full.kegCode, { to: 'RETIRED', version: 4, notes: '   ' }), /motivo/)
  await transitionKeg(admin, full.kegCode, { to: 'RETIRED', version: 4, notes: 'Daño estructural' })
  const retired = await prisma.keg.findUniqueOrThrow({ where: { id: full.id } })
  assert.equal(retired.status, 'RETIRED')
  assert.equal(await prisma.kegMovement.count({ where: { kegId: full.id } }), 6)
  const retirement = await prisma.kegMovement.findUniqueOrThrow({ where: { kegId_kegVersion: { kegId: full.id, kegVersion: 5 } } })
  assert.deepEqual([retirement.userId, retirement.fromStatus, retirement.toStatus, retirement.notes], [admin.id, 'DIRTY', 'RETIRED', 'Daño estructural'])
  await assert.rejects(transitionKeg(admin, full.kegCode, { to: 'CLEAN', version: 5 }), /perfil/)
  await assert.rejects(prisma.kegMovement.update({ where: { id: returned.id }, data: { notes: 'edit' } }), /append-only|permission denied/)
})
