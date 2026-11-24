import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codeFromScan, daysInCustody, formatRut, parseDate, validActions } from '../src/lib/domain'
import { readRegistry } from '../src/lib/registry'

test('normalizes portable label codes and supported scan links', () => {
  assert.equal(codeFromScan(' brl-001 '), 'BRL-001')
  assert.equal(codeFromScan('https://old-host.local:8443/scan?code=brl-001'), 'BRL-001')
  assert.equal(codeFromScan('https://old-host.local/clientes?code=brl-001'), null)
  assert.equal(codeFromScan('BRL-001/otra'), null)
})

test('canonicalizes and validates Chilean RUT checksums', () => {
  assert.equal(formatRut('760000000'), '76.000.000-0')
  assert.equal(formatRut('76.000.001-9'), '76.000.001-9')
  assert.equal(formatRut('12.345.670-k'), '12.345.670-K')
  assert.equal(formatRut('76.000.000-9'), null)
  assert.equal(formatRut('76/000/000-0'), null)
})

test('handles Chilean custody by calendar day even across a clock change', () => {
  assert.equal(daysInCustody(new Date('2026-09-05T04:00:00Z'), new Date('2026-10-06T03:00:00Z')), 31)
  assert.equal(parseDate('2026-02-29'), null)
  assert.equal(parseDate('2028-02-29')?.toISOString(), '2028-02-29T00:00:00.000Z')
})

test('restricts retirement to administrators and to empty or maintenance kegs', () => {
  assert.deepEqual(validActions('DIRTY', 'STAFF').map(({ to }) => to), ['CLEAN'])
  assert.deepEqual(validActions('CLEAN', 'STAFF').map(({ to }) => to), ['FULL'])
  assert.deepEqual(validActions('DIRTY', 'ADMIN').map(({ to }) => to), ['CLEAN', 'MAINTENANCE', 'RETIRED'])
  assert.deepEqual(validActions('CLEAN', 'ADMIN').map(({ to }) => to), ['FULL', 'MAINTENANCE', 'RETIRED'])
  assert.deepEqual(validActions('FULL', 'ADMIN').map(({ to }) => to), ['ON_TAP', 'AT_CLIENT'])
  assert.deepEqual(validActions('ON_TAP', 'ADMIN').map(({ to }) => to), ['DIRTY'])
  assert.deepEqual(validActions('AT_CLIENT', 'ADMIN').map(({ to }) => to), ['DIRTY'])
  assert.deepEqual(validActions('MAINTENANCE', 'ADMIN').map(({ to }) => to), ['DIRTY', 'RETIRED'])
  assert.deepEqual(validActions('RETIRED', 'ADMIN'), [])
})

test('shows active kegs by default and preserves explicit archive filters', () => {
  assert.deepEqual(readRegistry({}).where, { status: { not: 'RETIRED' } })
  assert.deepEqual(readRegistry({ estado: 'invalid' }).where, { status: { not: 'RETIRED' } })
  assert.deepEqual(readRegistry({ estado: 'ALL' }).where, {})
  assert.deepEqual(readRegistry({ estado: 'RETIRED' }).where, { status: 'RETIRED' })
  assert.equal(readRegistry({ estado: 'RETIRED' }).pageQuery(2), '?estado=RETIRED&p=2')
})
