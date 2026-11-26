import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Blocks,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Truck,
} from 'lucide-react'
import { supabase, supabaseConfigurationError } from '../lib/supabaseClient'

function isMissingTable(error) {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /pallets_eps.*does not exist|could not find the table.*pallets_eps/i.test(error?.message ?? '')
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'
}

export default function PlumavitEPS() {
  const [pallet, setPallet] = useState(null)
  const [codigoPallet, setCodigoPallet] = useState('')
  const [tableAvailable, setTableAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true

    async function loadActivePallet() {
      if (!supabase) {
        if (active) {
          setError(supabaseConfigurationError)
          setLoading(false)
        }
        return
      }

      try {
        const { data, error: queryError } = await supabase
          .from('pallets_eps')
          .select('codigo_pallet, bloques_actuales, estado')
          .eq('estado', 'EN_PROCESO')
          .limit(1)
          .maybeSingle()

        if (queryError) {
          if (isMissingTable(queryError)) {
            if (active) setTableAvailable(false)
            return
          }
          throw queryError
        }

        if (active && data) {
          setPallet(data)
          setCodigoPallet(data.codigo_pallet)
        }
      } catch (loadError) {
        if (active) setError(`No se pudo consultar el pallet activo: ${getErrorMessage(loadError)}`)
      } finally {
        if (active) setLoading(false)
      }
    }

    loadActivePallet()

    return () => {
      active = false
    }
  }, [])

  async function savePallet(nextPallet, create = false, successMessage = '') {
    if (!supabase) {
      setError(supabaseConfigurationError)
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    if (!tableAvailable) {
      setPallet(nextPallet)
      setNotice(
        `${successMessage || 'Pallet actualizado en esta pantalla.'} Se guardará en Supabase cuando exista la tabla pallets_eps.`,
      )
      setSaving(false)
      return
    }

    try {
      const request = create
        ? supabase
          .from('pallets_eps')
          .insert(nextPallet)
        : supabase
          .from('pallets_eps')
          .update({
            bloques_actuales: nextPallet.bloques_actuales,
            estado: nextPallet.estado,
          })
          .eq('codigo_pallet', nextPallet.codigo_pallet)

      const { data, error: saveError } = await request
        .select('codigo_pallet, bloques_actuales, estado')
        .single()

      if (saveError) {
        if (!isMissingTable(saveError)) throw saveError
        setTableAvailable(false)
        setPallet(nextPallet)
        setNotice('La tabla pallets_eps ya no está disponible. El cambio quedó solo en esta pantalla.')
        return
      }

      setPallet(data)
      setCodigoPallet(data.codigo_pallet)
      setNotice(successMessage || (create ? 'Pallet creado correctamente.' : 'Pallet actualizado correctamente.'))
    } catch (saveError) {
      setError(`No se pudo guardar el pallet: ${getErrorMessage(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  function handleCreatePallet(event) {
    event.preventDefault()
    const codigo = codigoPallet.trim()

    if (!codigo) {
      setError('Ingresa un código para el pallet.')
      return
    }

    savePallet({
      codigo_pallet: codigo.toUpperCase(),
      bloques_actuales: 1,
      estado: 'EN_PROCESO',
    }, true)
  }

  function handleAddBlock() {
    if (!pallet || pallet.estado === 'COMPLETO' || saving) return

    const bloquesActuales = Math.min(Number(pallet.bloques_actuales) + 1, 9)
    const nextPallet = {
      ...pallet,
      bloques_actuales: bloquesActuales,
      estado: bloquesActuales === 9 ? 'COMPLETO' : 'EN_PROCESO',
    }

    savePallet(nextPallet)
  }

  function handlePartialClose() {
    if (!pallet || pallet.estado !== 'EN_PROCESO' || saving) return

    savePallet(
      pallet,
      false,
      `Pallet parcial de ${pallet.bloques_actuales} bloques dejado para el cierre de turno.`,
    )
  }

  const canCreatePallet = !pallet || pallet.estado === 'COMPLETO'

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="rounded-2xl bg-indigo-900 p-5 text-white shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/15 p-3" aria-hidden="true">
              <Blocks className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-medium text-indigo-100">GreenSpot · Línea EPS</p>
              <h1 className="text-2xl font-bold tracking-tight">Prensado de Plumavit</h1>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-2 text-sm text-indigo-100">
            <Truck className="h-4 w-4" aria-hidden="true" />
            9 bloques de 1 m por pallet
          </p>
        </header>

        {!tableAvailable && (
          <div role="status" className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>
              La tabla <strong>pallets_eps</strong> no está disponible. Puedes continuar en esta pantalla,
              pero los cambios no se conservarán al recargar.
            </p>
          </div>
        )}

        {error && (
          <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        {notice && (
          <div role="status" className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>{notice}</p>
          </div>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
          {loading ? (
            <div className="flex items-center gap-3 py-8 text-slate-600" role="status">
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
              Consultando pallet activo...
            </div>
          ) : (
            <>
              {pallet && (
                <div className="mb-6 rounded-xl bg-slate-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-600">Pallet activo</p>
                      <p className="mt-1 break-all text-xl font-bold">{pallet.codigo_pallet}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                      pallet.estado === 'COMPLETO'
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-indigo-100 text-indigo-900'
                    }`}>
                      {pallet.estado === 'COMPLETO' ? 'COMPLETO' : 'EN PROCESO'}
                    </span>
                  </div>

                  <div className="mt-5 grid grid-cols-9 gap-1.5" aria-label={`${pallet.bloques_actuales} de 9 bloques`}>
                    {Array.from({ length: 9 }, (_, index) => (
                      <div
                        key={index}
                        className={`h-3 rounded-full ${
                          index < Number(pallet.bloques_actuales) ? 'bg-indigo-700' : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mt-3 text-center text-sm font-semibold text-slate-700">
                    {pallet.bloques_actuales} de 9 bloques prensados
                  </p>

                  {pallet.estado === 'COMPLETO' ? (
                    <p className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                      <Truck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      Listo para traslado por puerta interna hacia Bodega Exterior.
                    </p>
                  ) : (
                    <div className="mt-5 space-y-3">
                      <button
                        type="button"
                        onClick={handleAddBlock}
                        disabled={saving}
                        className="flex min-h-16 w-full items-center justify-center gap-2 rounded-xl bg-indigo-800 px-5 text-lg font-bold text-white transition hover:bg-indigo-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        {saving ? (
                          <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
                        ) : (
                          <Plus className="h-6 w-6" aria-hidden="true" />
                        )}
                        +1 Bloque Prensado (1m)
                      </button>
                      <button
                        type="button"
                        onClick={handlePartialClose}
                        disabled={saving}
                        className="min-h-12 w-full rounded-xl border-2 border-slate-300 px-4 text-base font-semibold text-slate-800 transition hover:border-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Dejar Pallet Parcial (&lt;9 bloques)
                      </button>
                    </div>
                  )}
                </div>
              )}

              {canCreatePallet && (
                <form className="space-y-4" onSubmit={handleCreatePallet}>
                  <div>
                    <label htmlFor="codigo_pallet" className="mb-2 block text-sm font-semibold">
                      {pallet ? 'Código del siguiente pallet' : 'Código del pallet'}
                    </label>
                    <input
                      id="codigo_pallet"
                      name="codigo_pallet"
                      type="text"
                      required
                      value={codigoPallet}
                      onChange={(event) => setCodigoPallet(event.target.value)}
                      placeholder="Ej. EPS-0001"
                      className="min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base uppercase outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-700/20"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-indigo-800 px-5 text-base font-bold text-white transition hover:bg-indigo-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {saving && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />}
                    {pallet ? 'Crear siguiente pallet' : 'Iniciar pallet'}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}
