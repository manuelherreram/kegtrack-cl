import { applyTransition } from '@/lib/actions'
import { ActionForm } from './form'
import { Expand, Field } from './ui'

export function RetireKeg({ kegCode, version }: { kegCode: string; version: number }) {
  return <Expand label="Dar de baja">
    <ActionForm action={applyTransition.bind(null, kegCode)} label="Confirmar baja" variant="danger">
      <input type="hidden" name="to" value="RETIRED" />
      <input type="hidden" name="version" value={version} />
      <p>Esta baja es definitiva. Podrás consultar su ficha y sus movimientos en el estado «Dado de baja».</p>
      <Field label="Motivo de baja"><input name="notes" maxLength={500} required /></Field>
    </ActionForm>
  </Expand>
}
