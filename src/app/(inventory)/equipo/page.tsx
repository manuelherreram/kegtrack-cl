import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/form'
import { Expand, Field, PageTitle } from '@/components/ui'
import { createStaff, setStaffActive } from '@/lib/actions'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const metadata = { title: 'Equipo' }

export default async function TeamPage() {
  const user = await requireUser()
  if (user.role !== 'ADMIN') notFound()
  const team = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, active: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  })
  return <>
    <PageTitle title="Equipo" detail="Cuentas individuales para identificar a quien registra cada movimiento." />
    <Expand label="Crear cuenta de personal">
      <ActionForm action={createStaff} label="Crear cuenta" resetOnSuccess>
        <div className="form-grid">
          <Field label="Nombre"><input name="name" maxLength={100} required /></Field>
          <Field label="Correo"><input name="email" type="email" maxLength={254} required /></Field>
          <Field label="Contraseña (mínimo 12 caracteres)"><input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></Field>
        </div>
      </ActionForm>
    </Expand>
    <section className="panel">
      <header className="panel-heading"><h2>Cuentas registradas</h2></header>
      <ul className="rows">{team.map((member) => <li key={member.id}>
        <div><strong>{member.name}</strong><small>{member.email}</small><small>{member.role === 'ADMIN' ? 'Administración' : 'Personal'} · {member.active ? 'Activa' : 'Desactivada'}</small></div>
        {member.role === 'STAFF' && <ActionForm action={setStaffActive.bind(null, member.id, !member.active)}
          label={member.active ? 'Desactivar' : 'Activar'} variant="secondary" className="inline-action" />}
      </li>)}</ul>
    </section>
  </>
}
