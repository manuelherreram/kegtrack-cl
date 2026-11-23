import { hashPassword, validPassword } from '../src/lib/password'
import { prisma } from '../src/lib/prisma'

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD ?? ''
  const name = (process.env.ADMIN_NAME ?? 'Administración').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 100) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_NAME to valid values.')
  }
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (existing.role !== 'ADMIN') throw new Error('ADMIN_EMAIL belongs to a staff account.')
    console.log('Administrator already exists.')
    return
  }
  if (!validPassword(password)) throw new Error('Set ADMIN_PASSWORD to at least 12 characters and at most 128 bytes.')
  await prisma.user.create({ data: { email, name, passwordHash: await hashPassword(password), role: 'ADMIN' } })
  console.log('Administrator created.')
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
