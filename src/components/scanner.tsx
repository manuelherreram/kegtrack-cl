'use client'

import { Camera, CameraOff, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import { codeFromScan } from '@/lib/domain'
import { Field } from './ui'

let previousCleanup: Promise<unknown> = Promise.resolve()

function CameraReader({ onResult, onStop }: { onResult: (code: string) => void; onStop: () => void }) {
  const id = useId()
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(true)

  useEffect(() => {
    let disposed = false
    let accepted = false
    let stop: (() => Promise<void>) | undefined
    const launched = previousCleanup.then(async () => {
      if (disposed) return
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        if (disposed) return
        const reader = new Html5Qrcode(id, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false })
        stop = async () => {
          try {
            if (reader.isScanning) await reader.stop()
            reader.clear()
          } catch (error) {
            console.warn('Camera cleanup failed', error)
          }
        }
        await reader.start({ facingMode: 'environment' }, {
          fps: 8,
          qrbox: (width, height) => {
            const size = Math.floor(Math.min(width, height) * 0.72)
            return { width: size, height: size }
          },
        }, (value) => {
          if (disposed || accepted) return
          const match = codeFromScan(value)
          if (!match) {
            setError('El QR no contiene un código de barril válido.')
            return
          }
          accepted = true
          onResult(match)
        }, () => {})
      } catch {
        if (!disposed) setError('No se pudo abrir la cámara. Revisa los permisos o ingresa el código manualmente.')
      } finally {
        if (!disposed) setStarting(false)
      }
    })
    return () => {
      disposed = true
      previousCleanup = launched.then(() => stop?.())
    }
  }, [id, onResult])

  return <div>
    <div id={id} className="camera-reader" />
    {starting && <p role="status">Abriendo cámara…</p>}
    {error && <p className="feedback error" role="alert">{error}</p>}
    <button className="button secondary" type="button" onClick={onStop}><CameraOff size={18} aria-hidden="true" />Cerrar cámara</button>
  </div>
}

export function Scanner({ initialCode }: { initialCode: string }) {
  const [open, setOpen] = useState(false)
  const [supported, setSupported] = useState<boolean | null>(null)
  const router = useRouter()
  useEffect(() => setSupported(Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia)), [])

  const [scanned, setScanned] = useState('')
  useEffect(() => {
    if (scanned) router.push(`/scan?code=${encodeURIComponent(scanned)}`)
  }, [router, scanned])
  // Use a stable callback while the video is running so its effect keeps the camera open.
  const onResult = useState(() => (code: string) => {
    setOpen(false)
    setScanned(code)
  })[0]

  return <section className="panel scanner">
    <header className="panel-heading"><h2>Identificar barril</h2></header>
    {open ? <CameraReader onResult={onResult} onStop={() => setOpen(false)} /> : supported &&
      <button className="button" type="button" onClick={() => { setScanned(''); setOpen(true) }}><Camera size={19} aria-hidden="true" />Abrir cámara</button>}
    {supported === false && <p className="scanner-hint">La cámara necesita HTTPS o localhost. Puedes buscar por código.</p>}
    <form className="manual" action="/scan" onSubmit={() => setOpen(false)}>
      <Field label="Código manual"><input key={initialCode} name="code" defaultValue={initialCode} placeholder="BRL-001" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={32} required /></Field>
      <button className="button secondary"><Search size={16} aria-hidden="true" />Buscar</button>
    </form>
  </section>
}
