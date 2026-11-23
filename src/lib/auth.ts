import { createHash, randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { prisma } from './prisma'
import { verifyPassword } from './password'

const cookieName = 'kegtrack_session'
const duration = 12 * 60 * 60
const userFields = { id: true, name: true, role: true, active: true } as const
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export const currentUser = cache(async () => {
  const token = (await cookies()).get(cookieName)?.value
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: hash(token) },
    select: { expiresAt: true, user: { select: userFields } },
  })
  return session && session.expiresAt > new Date() && session.user.active ? session.user : null
})

export async function requireUser() {
  const user = await currentUser()
  if (!user) redirect('/ingresar')
  return user
}

export async function signIn(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (user) {
    const [counter] = await prisma.$queryRaw<{ attempts: number }[]>`
      INSERT INTO "LoginAttempt" ("email", "attempts", "since") VALUES (${email}, 1, now())
      ON CONFLICT ("email") DO UPDATE SET
        "attempts" = CASE WHEN "LoginAttempt"."since" < now() - interval '15 minutes'
          THEN 1 ELSE LEAST("LoginAttempt"."attempts" + 1, 9) END,
        "since" = CASE WHEN "LoginAttempt"."since" < now() - interval '15 minutes'
          THEN now() ELSE "LoginAttempt"."since" END
      RETURNING "attempts"
    `
    if (counter.attempts > 8) return false
  }

  if (!await verifyPassword(password, user?.passwordHash) || !user?.active) return false

  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const jar = await cookies()
  const previousToken = jar.get(cookieName)?.value
  const requestHeaders = await headers()
  const secure = (requestHeaders.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https'

  await prisma.$transaction([
    prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lte: now } }, ...(previousToken ? [{ tokenHash: hash(previousToken) }] : [])] },
    }),
    prisma.loginAttempt.deleteMany({ where: { email } }),
    prisma.session.create({
      data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(+now + duration * 1000) },
    }),
  ])
  jar.set(cookieName, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: duration })
  return true
}

export async function clearSession() {
  const jar = await cookies()
  const token = jar.get(cookieName)?.value
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hash(token) } })
  jar.delete(cookieName)
}
