import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)

export function validPassword(password: string) {
  return password.length >= 12 && Buffer.byteLength(password) <= 128
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const key = await derive(password, salt, 64) as Buffer
  return `${salt}:${key.toString('hex')}`
}

export async function verifyPassword(password: string, hash?: string) {
  const [salt, key] = (hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':')
  const actual = await derive(password, salt, 64) as Buffer
  return timingSafeEqual(actual, Buffer.from(key, 'hex')) && Boolean(hash)
}
