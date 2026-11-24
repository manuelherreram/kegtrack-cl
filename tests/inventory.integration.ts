import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, test } from 'node:test'
import { beerKey, controlBatch } from '../src/lib/batches'
import { bulkFill, correctKeg, editKeg, registerKeg, transitionKeg, updateVolume } from '../src/lib/inventory'
import { prisma } from '../src/lib/prisma'
import { lotTraceCsv, readLotTrace } from '../src/lib/trace'

if (process.env.KEGTRACK_TEST_DB !== '1') throw new Error('Use a disposable migrated database and set KEGTRACK_TEST_DB=1.')

after(() => prisma.$disconnect())

test('guards concurrent movement, atomic bulk fill, tap uniqueness and append-only history', async () => {
  const scope = `QA-${randomBytes(5).toString('hex').toUpperCase()}`
  const actor = await prisma.user.create({ data: { email: `${scope.toLowerCase()}@example.test`, name: 'Integration test', passwordHash: 'test-only', role: 'STAFF' } })
  const admin = await prisma.user.create({ data: { email: `${scope.toLowerCase()}-admin@example.test`, name: 'Integration admin', passwordHash: 'test-only', role: 'ADMIN' } })
  const beer = await prisma.beer.create({ data: { name: scope, style: 'IPA', key: await beerKey(prisma, scope, 'IPA') } })
  const batch = await prisma.batch.create({
    data: { batchCode: scope, beerId: beer.id, beerName: beer.name, style: beer.style,
      fillDate: new Date('2000-01-01'), bestBeforeDate: new Date('2099-01-01'), packagedDeciliters: 700 },
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
  await assert.rejects(bulkFill(actor, batch.id, new Map([[a.id, { version: 1, liters: 20.3 }]])), /retención/)
  await controlBatch(admin, batch.id, 0, 'RELEASED', undefined, 'Control de calidad')
  await assert.rejects(bulkFill(actor, batch.id, new Map([[a.id, { version: 1, liters: 20.3 }], [b.id, { version: 0, liters: 30 }]])), /cambió/)
  assert.equal((await prisma.keg.findUniqueOrThrow({ where: { id: a.id } })).status, 'CLEAN')
  assert.equal(await prisma.kegMovement.count({ where: { kegId: a.id } }), 2)

  assert.equal(await bulkFill(actor, batch.id, new Map([[a.id, { version: 1, liters: 20.3 }], [b.id, { version: 1, liters: 30 }]])), 2)
  assert.equal((await prisma.keg.findUniqueOrThrow({ where: { id: a.id } })).remainingLiters, 20.3)
  assert.equal((await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).allocatedDeciliters, 503)
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

test('tracks actual liters, date and hold rules, corrections, returns and a lot recall', async () => {
  const scope = `LOT-${randomBytes(5).toString('hex').toUpperCase()}`
  const admin = await prisma.user.create({ data: { email: `${scope}@example.test`, name: 'Admin', passwordHash: 'test-only', role: 'ADMIN' } })
  const staff = await prisma.user.create({ data: { email: `${scope}-staff@example.test`, name: 'Staff', passwordHash: 'test-only', role: 'STAFF' } })
  const beer = await prisma.beer.create({ data: { name: scope, style: 'Stout', key: await beerKey(prisma, scope, 'Stout') } })
  const client = await prisma.client.create({ data: { name: '=Cliente "prueba"', rut: scope, comuna: 'Ñuñoa', address: 'Prueba' } })
  const base = { beerId: beer.id, beerName: beer.name, style: beer.style, packagedDeciliters: 500, status: 'RELEASED' } as const
  const lot = await prisma.batch.create({ data: { ...base, batchCode: scope, fillDate: new Date('2000-01-01'), bestBeforeDate: new Date('2099-01-01') } })
  const old = await prisma.batch.create({ data: { ...base, batchCode: scope + '-OLD', fillDate: new Date('2000-01-01'), bestBeforeDate: new Date('2001-01-01') } })
  const future = await prisma.batch.create({ data: { ...base, batchCode: scope + '-NEW', fillDate: new Date('2999-01-01'), bestBeforeDate: new Date('2999-12-01') } })
  const [first, second] = await prisma.$transaction(async (tx) => {
    const data = { sizeLiters: 30, couplerType: 'G', status: 'CLEAN' } as const
    return Promise.all([
      registerKeg(tx, admin.id, { ...data, kegCode: scope + '-A' }),
      registerKeg(tx, admin.id, { ...data, kegCode: scope + '-B' }),
    ])
  })
  const fill = (kegCode: string, batchId: string, version = 0, remainingLiters = 27.4) =>
    transitionKeg(staff, kegCode, { to: 'FULL', version, batchId, remainingLiters })
  await assert.rejects(fill(first.kegCode, old.id), /consumo preferente/)
  await assert.rejects(fill(first.kegCode, future.id), /aún no ha llegado/)
  await assert.rejects(fill(first.kegCode, lot.id, 0, 30.1), /volumen/)
  await assert.rejects(controlBatch(staff, lot.id, 0, 'HOLD', undefined, 'Prueba'), /administración/)

  const fills = await Promise.allSettled([fill(first.kegCode, lot.id), fill(second.kegCode, lot.id)])
  assert.equal(fills.filter((result) => result.status === 'fulfilled').length, 1)
  const [filled, empty] = fills[0].status === 'fulfilled' ? [first, second] : [second, first]
  const stock = async () => (await prisma.batch.findUniqueOrThrow({ where: { id: lot.id } })).allocatedDeciliters
  assert.equal(await stock(), 274)
  await assert.rejects(correctKeg(staff, filled.kegCode, 1, 'Escaneo equivocado'), /administración/)
  await correctKeg(admin, filled.kegCode, 1, 'Escaneo equivocado')
  assert.equal(await stock(), 0)
  await assert.rejects(correctKeg(admin, filled.kegCode, 2, 'Repetido'), /no se puede/)
  await fill(empty.kegCode, lot.id, 0, 23.5)
  assert.equal(await stock(), 235)

  const move = (change: Parameters<typeof transitionKeg>[2]) => transitionKeg(staff, empty.kegCode, change)
  await controlBatch(admin, lot.id, 0, 'HOLD', undefined, 'Control preventivo')
  await assert.rejects(move({ to: 'AT_CLIENT', version: 1, clientId: client.id }), /retención/)
  await assert.rejects(controlBatch(admin, lot.id, 1, 'RELEASED', 200, 'Volumen menor'), /ya registrados/)
  await controlBatch(admin, lot.id, 1, 'RELEASED', undefined, 'Control aprobado')
  await move({ to: 'AT_CLIENT', version: 1, clientId: client.id, guiaDespacho: 'GD-01' })
  await move({ to: 'FULL', action: 'RETURN_COLD', version: 2, remainingLiters: 9.5 })
  const returnedKeg = await prisma.keg.findUniqueOrThrow({ where: { id: empty.id } })
  assert.deepEqual([returnedKeg.currentBatchId, returnedKeg.currentClientId, returnedKeg.remainingLiters], [lot.id, null, 9.5])
  await assert.rejects(move({ to: 'DIRTY', action: 'DISCARD', version: 3, discardedLiters: 9.5 }), /motivo/)
  await move({ to: 'DIRTY', action: 'DISCARD', version: 3, discardedLiters: 9.5, notes: 'Prueba de descarte' })
  assert.equal(await stock(), 235)
  await editKeg(admin, empty.kegCode, 4, { sizeLiters: 20, couplerType: 'A', notes: 'Prueba' }, 'Capacidad verificada')
  assert.equal((await prisma.keg.findUniqueOrThrow({ where: { id: empty.id } })).kegCode, empty.kegCode)

  const trace = await readLotTrace(lot.id)
  assert.ok(trace)
  assert.equal(trace.kegs.length, 0)
  assert.equal(trace.movements.find((m) => m.kind === 'DELIVER')?.client?.name, client.name)
  assert.equal(trace.movements.find((m) => m.kind === 'RETURN_COLD')?.client?.name, client.name)
  assert.equal(trace.movements.find((m) => m.kind === 'DISCARD')?.discardedLiters, 9.5)
  assert.ok(trace.movements.some((m) => m.kind === 'FILL' && m.correctedBy))
  assert.match(lotTraceCsv(trace), /"'=Cliente ""prueba"""/)
  assert.match(lotTraceCsv(trace), /De.?voluci|Regreso a cámara/)
  assert.match(lotTraceCsv(trace), /;9,5;/)
})
