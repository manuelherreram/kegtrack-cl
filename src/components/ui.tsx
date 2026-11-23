import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'
import { statuses, type Status } from '@/lib/domain'
import { ChevronDown } from 'lucide-react'

export function PageTitle({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <header className="page-title">
    <div><h1>{title}</h1>{detail && <p>{detail}</p>}</div>
    {action && <div className="page-action">{action}</div>}
  </header>
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`status status-${status.toLowerCase()}`}><i aria-hidden="true" />{statuses[status]}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Field({ label, children, wide = false }: {
  label: string
  children: ReactElement<{ id?: string }>
  wide?: boolean
}) {
  const fallbackId = useId()
  const id = children.props.id ?? fallbackId
  return <div className={wide ? 'field wide' : 'field'}>
    <label htmlFor={id}>{label}</label>{cloneElement(children, { id })}
  </div>
}

export function Expand({ label, children }: { label: string; children: ReactNode }) {
  return <details className="expand"><summary>{label}<ChevronDown size={17} aria-hidden="true" /></summary><div>{children}</div></details>
}
