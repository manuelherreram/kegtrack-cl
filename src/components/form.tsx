'use client'

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from 'react'
import type { Feedback } from '@/lib/actions'

type Action = (previous: Feedback, fields: FormData) => Promise<Feedback>

export function ActionForm({ action, children, label, className = '', resetOnSuccess = false, variant = '' }: {
  action: Action
  children?: ReactNode
  label: string
  className?: string
  resetOnSuccess?: boolean
  variant?: 'secondary' | 'danger' | ''
}) {
  const [state, dispatch, pending] = useActionState(action, {})
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (resetOnSuccess && state.message) formRef.current?.reset()
  }, [state, resetOnSuccess])

  return <form ref={formRef} action={dispatch} className={`action-form ${className}`} onSubmit={(event) => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    startTransition(() => dispatch(fields))
  }}>
    <fieldset disabled={pending}>
      {children}
      <button className={`button ${variant}`} type="submit">{pending ? 'Guardando…' : label}</button>
    </fieldset>
    {state.error && <p className="feedback error" role="alert">{state.error}</p>}
    {state.message && <p className="feedback success" role="status">{state.message}</p>}
  </form>
}
