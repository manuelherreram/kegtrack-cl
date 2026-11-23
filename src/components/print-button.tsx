'use client'

import { Printer } from 'lucide-react'

export function PrintButton() {
  return <button className="button" type="button" onClick={() => window.print()}><Printer size={18} aria-hidden="true" />Imprimir etiquetas</button>
}
