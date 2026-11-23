export const statuses = {
  DIRTY: 'Sucio / vacío',
  CLEAN: 'Limpio',
  FULL: 'Cámara de frío',
  ON_TAP: 'Pinchado en barra',
  AT_CLIENT: 'En cliente',
  MAINTENANCE: 'Mantención',
  RETIRED: 'Dado de baja',
} as const

export type Status = keyof typeof statuses
export type Role = 'ADMIN' | 'STAFF'

export const couplers = { G: 'Tipo G', A: 'Tipo A', S: 'Tipo S', BALL_LOCK: 'Ball Lock' } as const
export const sizes = [19, 20, 30, 50] as const
export const kegCodePattern = /^[A-Z0-9][A-Z0-9-]{1,31}$/
export const santiago = 'America/Santiago'

type Option = { to: Status; label: string; admin?: boolean }

const maintenance: Option = { to: 'MAINTENANCE', label: 'Enviar a mantención', admin: true }
const transitions: Record<Status, readonly Option[]> = {
  DIRTY: [{ to: 'CLEAN', label: 'Registrar sanitización' }, maintenance],
  CLEAN: [{ to: 'FULL', label: 'Llenar desde un lote' }, maintenance],
  FULL: [{ to: 'ON_TAP', label: 'Pinchar en barra' }, { to: 'AT_CLIENT', label: 'Registrar entrega' }],
  ON_TAP: [{ to: 'DIRTY', label: 'Barril vacío' }],
  AT_CLIENT: [{ to: 'DIRTY', label: 'Registrar devolución' }],
  MAINTENANCE: [
    { to: 'DIRTY', label: 'Reintegrar como sucio', admin: true },
    { to: 'RETIRED', label: 'Dar de baja', admin: true },
  ],
  RETIRED: [],
}

export function validActions(status: Status, role: Role) {
  return transitions[status].filter((action) => !action.admin || role === 'ADMIN')
}

export function codeFromScan(raw: string) {
  let code = raw.trim()
  if (code.length > 512) return null
  if (/^https?:\/\//i.test(code)) {
    try {
      const url = new URL(code)
      if (url.pathname !== '/scan' && url.pathname !== '/scan/') return null
      code = url.searchParams.get('code') ?? ''
    } catch {
      return null
    }
  }
  code = code.trim().toUpperCase()
  return kegCodePattern.test(code) ? code : null
}

function checkDigit(body: string) {
  let sum = 0
  for (let index = body.length - 1, factor = 2; index >= 0; index--, factor = factor === 7 ? 2 : factor + 1) {
    sum += Number(body[index]) * factor
  }
  const digit = 11 - (sum % 11)
  return digit === 11 ? '0' : digit === 10 ? 'K' : String(digit)
}

export function formatRut(value: string) {
  const input = value.trim().toUpperCase()
  if (!/^(?:\d{1,8}|\d{1,2}(?:\.\d{3}){2})-?[0-9K]$/.test(input)) return null
  const compact = input.replace(/[.\-]/g, '')
  const body = compact.slice(0, -1).replace(/^0+/, '')
  const digit = compact.slice(-1)
  if (!body || checkDigit(body) !== digit) return null
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${digit}`
}

export function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? date : null
}

export function calendarDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: santiago, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  return ['year', 'month', 'day'].map((kind) => parts.find((part) => part.type === kind)?.value).join('-')
}

export function daysInCustody(delivered: Date, today = new Date()) {
  return (+new Date(calendarDate(today)) - +new Date(calendarDate(delivered))) / 86_400_000
}

export const dateLabel = (date: Date) => new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', dateStyle: 'medium' }).format(date)
export const timeLabel = (date: Date) => new Intl.DateTimeFormat('es-CL', { timeZone: santiago, dateStyle: 'medium', timeStyle: 'short' }).format(date)
export const liters = (value: number) => `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(value)} L`
export const clp = (value: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(value)
