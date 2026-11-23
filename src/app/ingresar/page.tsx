import { Barrel } from 'lucide-react'
import { redirect } from 'next/navigation'
import { ActionForm } from '@/components/form'
import { Field } from '@/components/ui'
import { login } from '@/lib/actions'
import { currentUser } from '@/lib/auth'

export const metadata = { title: 'Ingresar' }

export default async function LoginPage() {
  if (await currentUser()) redirect('/')
  return <main className="login-page">
    <section className="login-card">
      <div className="brand"><span className="brand-mark"><Barrel size={23} aria-hidden="true" /></span>KegTrack<span>CL</span></div>
      <h1>Ingresa a tu cuenta</h1>
      <ActionForm action={login} label="Ingresar">
        <Field label="Correo"><input name="email" type="email" autoComplete="username" maxLength={254} required /></Field>
        <Field label="Contraseña"><input name="password" type="password" autoComplete="current-password" maxLength={128} required /></Field>
      </ActionForm>
    </section>
  </main>
}
