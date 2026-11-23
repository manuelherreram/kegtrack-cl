'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { clearSession, requireUser, signIn } from './auth'
import { couplers, formatRut, kegCodePattern, parseDate, sizes, statuses, type Status } from './domain'
import { bulkFill, InputError, registerKeg, transitionKeg, updateVolume } from './inventory'
import { hashPassword, validPassword } from './password'
import { prisma } from './prisma'

export type Feedback = { message?: string; error?: string }

function read(form: FormData, name: string, max: number, required = true, trim = true) {
  const value = form.get(name)
  const text = typeof value === 'string' ? (trim ? value.trim() : value) : ''
  const label = fieldLabels[name] ?? name
  if ((required && !text) || text.length > max) throw new InputError(`Revisa el campo «${label}».`)
  return text
}

const fieldLabels: Record<string, string> = {
  name: 'Nombre', email: 'Correo', password: 'Contraseña', role: 'Perfil',
  kegCode: 'Código de barril', couplerType: 'Conector', sizeLiters: 'Capacidad',
  batchCode: 'Código de lote', beerName: 'Cerveza', style: 'Estilo', fillDate: 'Fecha de llenado',
  bestBeforeDate: 'Consumo preferente', rut: 'RUT', comuna: 'Comuna', address: 'Dirección',
  contactName: 'Contacto', contactPhone: 'Teléfono', tapLine: 'Línea de barra',
  remainingLiters: 'Litros restantes', depositClp: 'Garantía', guiaDespacho: 'Guía de despacho',
  notes: 'Notas', batchId: 'Lote', clientId: 'Cliente', version: 'Versión del barril', to: 'Acción',
}

function numeric(form: FormData, name: string, min: number, max: number, decimal = false, required = true) {
  const text = read(form, name, 24, required)
  if (!text) return undefined
  const value = Number(text.replace(',', '.'))
  if (!(decimal ? /^\d+(?:[.,]\d)?$/ : /^\d+$/).test(text) || !Number.isFinite(value) || value < min || value > max) {
    throw new InputError(`Revisa el campo «${fieldLabels[name]}».`)
  }
  return value
}

function emailField(form: FormData) {
  const email = read(form, 'email', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('Ingresa un correo válido.')
  return email
}

function uniqueError(error: Prisma.PrismaClientKnownRequestError) {
  const fields = Array.isArray(error.meta?.target) ? error.meta.target : []
  if (fields.includes('tapLine')) return 'Esa línea de barra ya está ocupada.'
  if (fields.includes('rut')) return 'Ya existe un cliente con ese RUT.'
  if (fields.includes('email')) return 'Ya existe un usuario con ese correo.'
  return 'Ese código ya está registrado.'
}

async function perform(operation: () => Promise<string>): Promise<Feedback> {
  try {
    const message = await operation()
    revalidatePath('/', 'layout')
    return { message }
  } catch (error) {
    if (error instanceof InputError) return { error: error.message }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return { error: uniqueError(error) }
      if (error.code === 'P2034') return { error: 'Hubo un cambio simultáneo. Actualiza y vuelve a intentar.' }
    }
    console.error('KegTrack action failed', error)
    return { error: 'No se pudo guardar. Revisa la conexión y vuelve a intentar.' }
  }
}

async function adminUser() {
  const user = await requireUser()
  return user.role === 'ADMIN' ? user : null
}

const unauthorized = { error: 'Solo administración puede realizar esta acción.' }

export async function login(_prev: Feedback, form: FormData): Promise<Feedback> {
  let success: boolean
  try {
    const email = emailField(form)
    const password = read(form, 'password', 128, true, false)
    if (Buffer.byteLength(password) > 128) return { error: 'Correo o contraseña incorrectos.' }
    success = await signIn(email, password)
  } catch (error) {
    if (error instanceof InputError) return { error: 'Correo o contraseña incorrectos.' }
    console.error('KegTrack login failed', error)
    return { error: 'No se pudo iniciar sesión. Intenta nuevamente.' }
  }
  if (!success) return { error: 'Correo o contraseña incorrectos. Si hubo varios intentos, espera 15 minutos.' }
  redirect('/')
}

export async function logout() {
  await clearSession()
  redirect('/ingresar')
}

export async function createKeg(_prev: Feedback, form: FormData) {
  const user = await adminUser()
  if (!user) return unauthorized
  return perform(async () => {
    const kegCode = read(form, 'kegCode', 32).toUpperCase()
    const couplerType = read(form, 'couplerType', 12)
    const sizeLiters = numeric(form, 'sizeLiters', 19, 50)!
    const notes = read(form, 'notes', 500, false)
    if (!kegCodePattern.test(kegCode)) throw new InputError('Usa de 2 a 32 letras, números o guiones para el código.')
    if (!sizes.some((size) => size === sizeLiters) || !Object.hasOwn(couplers, couplerType)) {
      throw new InputError('Selecciona una capacidad y un conector válidos.')
    }
    await prisma.$transaction((tx) => registerKeg(tx, user.id, {
      kegCode, couplerType: couplerType as keyof typeof couplers, sizeLiters, notes: notes || null,
    }))
    return `Barril ${kegCode} registrado.`
  })
}

export async function createBatch(_prev: Feedback, form: FormData) {
  const user = await adminUser()
  if (!user) return unauthorized
  return perform(async () => {
    const batchCode = read(form, 'batchCode', 40).toUpperCase()
    const beerName = read(form, 'beerName', 100)
    const style = read(form, 'style', 100)
    const fillDate = parseDate(read(form, 'fillDate', 10))
    const bestBeforeDate = parseDate(read(form, 'bestBeforeDate', 10))
    if (!fillDate || !bestBeforeDate || bestBeforeDate < fillDate) throw new InputError('El consumo preferente debe ser el día de llenado o posterior.')
    await prisma.batch.create({ data: { batchCode, beerName, style, fillDate, bestBeforeDate } })
    return `Lote ${batchCode} creado.`
  })
}

export async function createClient(_prev: Feedback, form: FormData) {
  const user = await adminUser()
  if (!user) return unauthorized
  return perform(async () => {
    const rut = formatRut(read(form, 'rut', 20))
    if (!rut) throw new InputError('Ingresa un RUT chileno válido.')
    const name = read(form, 'name', 120)
    const comuna = read(form, 'comuna', 80)
    const address = read(form, 'address', 180)
    const contactName = read(form, 'contactName', 100, false)
    const contactPhone = read(form, 'contactPhone', 40, false)
    await prisma.client.create({ data: { rut, name, comuna, address, contactName, contactPhone } })
    return `Cliente ${name} registrado.`
  })
}

export async function createStaff(_prev: Feedback, form: FormData) {
  const user = await adminUser()
  if (!user) return unauthorized
  return perform(async () => {
    const email = emailField(form)
    const name = read(form, 'name', 100)
    const password = read(form, 'password', 128, true, false)
    if (!validPassword(password)) throw new InputError('La contraseña debe tener al menos 12 caracteres y hasta 128 bytes.')
    const passwordHash = await hashPassword(password)
    await prisma.user.create({ data: { email, name, passwordHash, role: 'STAFF' } })
    return `Cuenta de personal creada para ${name}.`
  })
}

export async function setStaffActive(id: string, active: boolean, _prev: Feedback, _form: FormData) {
  const user = await adminUser()
  if (!user) return unauthorized
  return perform(async () => {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({ where: { id, role: 'STAFF' }, data: { active } })
      if (!changed.count) throw new InputError('No se encontró la cuenta de personal.')
      if (!active) await tx.session.deleteMany({ where: { userId: id } })
    })
    return active ? 'Cuenta activada.' : 'Cuenta desactivada.'
  })
}

export async function applyTransition(kegCode: string, _prev: Feedback, form: FormData) {
  const user = await requireUser()
  return perform(async () => {
    const to = read(form, 'to', 20)
    if (!Object.hasOwn(statuses, to)) throw new InputError('Selecciona una acción válida.')
    const version = numeric(form, 'version', 0, 2_147_483_647)!
    const change = { to: to as Status, version, notes: read(form, 'notes', 500, false) || undefined }
    switch (change.to) {
      case 'FULL':
        Object.assign(change, { batchId: read(form, 'batchId', 64) })
        break
      case 'ON_TAP':
        Object.assign(change, {
          tapLine: numeric(form, 'tapLine', 1, 999),
          remainingLiters: numeric(form, 'remainingLiters', 0, 50, true, false),
        })
        break
      case 'AT_CLIENT':
        Object.assign(change, {
          clientId: read(form, 'clientId', 64),
          guiaDespacho: read(form, 'guiaDespacho', 64, false) || undefined,
          depositClp: numeric(form, 'depositClp', 0, 2_147_483_647, false, false),
        })
        break
    }
    await transitionKeg(user, kegCode, change)
    return `Movimiento registrado · ${statuses[change.to]}.`
  })
}

export async function fillBatch(_prev: Feedback, form: FormData) {
  const user = await requireUser()
  return perform(async () => {
    const batchId = read(form, 'batchId', 64)
    const entries = form.getAll('keg')
    if (!entries.length || entries.length > 100) throw new InputError('Selecciona de 1 a 100 barriles limpios.')
    const selected = new Map<string, number>()
    for (const value of entries) {
      const match = typeof value === 'string' ? /^([\w-]{1,64}):(\d{1,10})$/.exec(value) : null
      if (!match || selected.has(match[1]) || Number(match[2]) > 2_147_483_647) throw new InputError('Revisa la selección de barriles.')
      selected.set(match[1], Number(match[2]))
    }
    const count = await bulkFill(user, batchId, selected)
    return count === 1 ? '1 barril llenado.' : `${count} barriles llenados.`
  })
}

export async function saveVolume(kegCode: string, _prev: Feedback, form: FormData) {
  const user = await requireUser()
  return perform(async () => {
    const version = numeric(form, 'version', 0, 2_147_483_647)!
    const volume = numeric(form, 'remainingLiters', 0, 50, true)!
    await updateVolume(user, kegCode, version, volume)
    return 'Volumen estimado guardado.'
  })
}
