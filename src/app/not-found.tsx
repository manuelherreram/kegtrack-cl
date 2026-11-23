import Link from 'next/link'

export default function NotFound() {
  return <section className="panel not-found">
    <h1>Página no encontrada</h1>
    <Link className="button" href="/">Volver al resumen</Link>
  </section>
}
