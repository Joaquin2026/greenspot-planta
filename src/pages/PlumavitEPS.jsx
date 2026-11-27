import { useEffect, useMemo, useState } from 'react'
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
  if (error instanceof Error) return error.message
  if (typeof error?.message === 'string') return error.message
  return 'Ocurrió un error inesperado.'
}

function palletCode(sequence) {
  return `PALLET-EPS-${String(sequence).padStart(2, '0')}`
}

function sortByIdAscending(a, b) {
  const firstId = Number(a.id_pallet)
  const secondId = Number(b.id_pallet)
  if (Number.isFinite(firstId) && Number.isFinite(secondId)) return firstId - secondId
  return a.codigo_pallet.localeCompare(b.codigo_pallet)
}

function sortByIdDescending(a, b) {
  return sortByIdAscending(b, a)
}

function BlockMeter({ blocks }) {
  return (
    <>
      <div className="mt-4 grid grid-cols-9 gap-1.5" aria-label={`${blocks} de 9 bloques`}>
        {Array.from({ length: 9 }, (_, index) => (
          <div
            key={index}
            className={`h-3 rounded-full ${
              index < Number(blocks) ? 'bg-indigo-700' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
      <p className="mt-2 text-center text-sm font-semibold text-slate-700">
        {blocks} de 9 bloques prensados
      </p>
    </>
  )
}

export default function PlumavitEPS({ user }) {
  const [palletsEnProceso, setPalletsEnProceso] = useState([])
  const [palletsCerrados, setPalletsCerrados] = useState([])
  const [selectedPalletId, setSelectedPalletId] = useState('')
  const [nextPalletNumber, setNextPalletNumber] = useState(1)
  const [tableAvailable, setTableAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedPallet = useMemo(
    () => palletsEnProceso.find((pallet) => String(pallet.id_pallet) === selectedPalletId) ?? null,
    [palletsEnProceso, selectedPalletId],
  )

  async function cargarPallets({ showLoading = true } = {}) {
    if (!supabase) {
      setError(supabaseConfigurationError)
      setLoading(false)
      return false
    }

    if (showLoading) setLoading(true)
    try {
      const [openResult, closedResult, latestResult] = await Promise.all([
        supabase
          .from('pallets_eps')
          .select('id_pallet, codigo_pallet, bloques_actuales, estado')
          .eq('estado', 'EN_PROCESO')
          .order('id_pallet', { ascending: true }),
        supabase
          .from('pallets_eps')
          .select('id_pallet, codigo_pallet, bloques_actuales, estado')
          .in('estado', ['COMPLETO', 'BODEGA_EXTERIOR'])
          .order('id_pallet', { ascending: false })
          .limit(5),
        supabase
          .from('pallets_eps')
          .select('id_pallet')
          .order('id_pallet', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      const missingTableError = [openResult.error, closedResult.error, latestResult.error]
        .find(isMissingTable)
      if (missingTableError) {
        setTableAvailable(false)
        setPalletsEnProceso([])
        setPalletsCerrados([])
        setNextPalletNumber(1)
        setSelectedPalletId('')
        setError('')
        return false
      }

      if (openResult.error) throw openResult.error
      if (closedResult.error) throw closedResult.error
      if (latestResult.error) throw latestResult.error

      const abiertos = openResult.data ?? []
      setTableAvailable(true)
      setPalletsEnProceso(abiertos)
      setPalletsCerrados(closedResult.data ?? [])
      setNextPalletNumber((Number(latestResult.data?.id_pallet) || 0) + 1)
      setSelectedPalletId((current) => (
        abiertos.some((pallet) => String(pallet.id_pallet) === current)
          ? current
          : ''
      ))
      setError('')
      return true
    } catch (loadError) {
      setError(`No se pudieron cargar los pallets: ${getErrorMessage(loadError)}`)
      return false
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    async function initialLoad() {
      await cargarPallets()
    }

    initialLoad()
  }, [])

  function updateLocalPallet(updatedPallet) {
    setPalletsEnProceso((current) => {
      if (updatedPallet.estado === 'EN_PROCESO') {
        const exists = current.some((item) => String(item.id_pallet) === String(updatedPallet.id_pallet))
        return (exists
          ? current.map((item) => (
            String(item.id_pallet) === String(updatedPallet.id_pallet) ? updatedPallet : item
          ))
          : [...current, updatedPallet]
        ).sort(sortByIdAscending)
      }

      return current.filter((item) => String(item.id_pallet) !== String(updatedPallet.id_pallet))
    })

    if (updatedPallet.estado === 'COMPLETO' || updatedPallet.estado === 'BODEGA_EXTERIOR') {
      setPalletsCerrados((current) => (
        [updatedPallet, ...current.filter(
          (item) => String(item.id_pallet) !== String(updatedPallet.id_pallet),
        )]
          .sort(sortByIdDescending)
          .slice(0, 5)
      ))
      setSelectedPalletId((current) => (
        String(updatedPallet.id_pallet) === current ? '' : current
      ))
    }
  }

  async function handleCreatePallet() {
    setError('')
    setNotice('')
    if (!supabase) {
      setError(supabaseConfigurationError)
      return
    }

    setSaving(true)
    let createdPallet = null

    try {
      let sequence = nextPalletNumber
      let newPallet = {
        codigo_pallet: palletCode(sequence),
        bloques_actuales: 1,
        estado: 'EN_PROCESO',
      }

      if (tableAvailable && supabase) {
        const { data: latest, error: latestError } = await supabase
          .from('pallets_eps')
          .select('id_pallet')
          .order('id_pallet', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (latestError) {
          if (!isMissingTable(latestError)) throw latestError
          setTableAvailable(false)
        } else {
          sequence = (Number(latest?.id_pallet) || 0) + 1
          newPallet.codigo_pallet = palletCode(sequence)

          const { data, error: insertError } = await supabase
            .from('pallets_eps')
            .insert(newPallet)
            .select('id_pallet, codigo_pallet, bloques_actuales, estado')
            .single()

          if (insertError) throw insertError
          newPallet = data
          createdPallet = data

          const { error: auditError } = await supabase
            .from('logs_auditoria')
            .insert({
              tabla_afectada: 'pallets_eps',
              id_registro: Number(createdPallet?.id_pallet) || 0,
              operacion: 'INSERT',
              datos_nuevos: createdPallet,
              usuario_nombre: user.nombre_completo,
            })

          if (auditError) throw auditError
        }
      }

      if (!newPallet.id_pallet) {
        newPallet = { ...newPallet, id_pallet: `local-${sequence}` }
      }

      setNextPalletNumber(sequence + 1)
      setPalletsEnProceso((current) => [...current, newPallet].sort(sortByIdAscending))
      setSelectedPalletId(String(newPallet.id_pallet))
      setNotice(tableAvailable
        ? `${newPallet.codigo_pallet} creado y seleccionado.`
        : `${newPallet.codigo_pallet} creado en esta pantalla; la tabla no está disponible y no se conservará al recargar.`)

      if (tableAvailable) await cargarPallets({ showLoading: false })
    } catch (createError) {
      if (createdPallet) {
        setNextPalletNumber((Number(createdPallet.id_pallet) || 0) + 1)
        setPalletsEnProceso((current) => [...current, createdPallet].sort(sortByIdAscending))
        setSelectedPalletId(String(createdPallet.id_pallet))
        setError(
          `${createdPallet.codigo_pallet} fue creado, pero no se pudo registrar la auditoría: ${getErrorMessage(createError)}`,
        )
      } else {
        setError(`No se pudo iniciar un nuevo pallet: ${getErrorMessage(createError)}`)
      }
    } finally {
      setSaving(false)
    }
  }

  async function persistPallet(updatedPallet, successMessage, audit = false) {
    if (!selectedPallet || saving) return
    if (!supabase) {
      setError(supabaseConfigurationError)
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    let updateSaved = false

    try {
      if (tableAvailable && supabase) {
        const { data, error: updateError } = await supabase
          .from('pallets_eps')
          .update({
            bloques_actuales: updatedPallet.bloques_actuales,
            estado: updatedPallet.estado,
          })
          .eq('id_pallet', selectedPallet.id_pallet)
          .eq('estado', 'EN_PROCESO')
          .select('id_pallet, codigo_pallet, bloques_actuales, estado')
          .single()

        if (updateError) throw updateError
        updatedPallet = data
        updateSaved = true

        if (audit) {
          const { error: auditError } = await supabase
            .from('logs_auditoria')
            .insert({
              tabla_afectada: 'pallets_eps',
              id_registro: Number(updatedPallet?.id_pallet) || 0,
              operacion: 'UPDATE',
              datos_nuevos: updatedPallet,
              usuario_nombre: user.nombre_completo,
            })

          if (auditError) throw auditError
        }
      }

      updateLocalPallet(updatedPallet)
      setNotice(tableAvailable
        ? successMessage
        : `${successMessage} Solo está guardado en esta pantalla porque la tabla no está disponible.`)

      if (tableAvailable) await cargarPallets({ showLoading: false })
    } catch (saveError) {
      if (updateSaved) updateLocalPallet(updatedPallet)
      setError(`No se pudo guardar ${selectedPallet.codigo_pallet}: ${getErrorMessage(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  function handleAddBlock() {
    if (!selectedPallet || selectedPallet.estado !== 'EN_PROCESO' || saving) return

    const bloquesActuales = Math.min(Number(selectedPallet.bloques_actuales) + 1, 9)
    const updatedPallet = {
      ...selectedPallet,
      bloques_actuales: bloquesActuales,
      estado: bloquesActuales === 9 ? 'COMPLETO' : 'EN_PROCESO',
    }

    const message = bloquesActuales === 9
      ? `${selectedPallet.codigo_pallet} completado. Listo para traslado por puerta interna a Bodega Exterior.`
      : `${selectedPallet.codigo_pallet} actualizado: ${bloquesActuales} de 9 bloques.`
    persistPallet(updatedPallet, message)
  }

  function handleSavePartial() {
    if (!selectedPallet || selectedPallet.estado !== 'EN_PROCESO' || saving) return

    persistPallet(
      { ...selectedPallet, estado: 'EN_PROCESO' },
      `${selectedPallet.codigo_pallet} guardado para retomarlo en el siguiente turno.`,
      true,
    )
  }

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

        <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm sm:p-6">
          {loading ? (
            <div className="flex items-center gap-3 py-8 text-slate-600" role="status">
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
              Cargando pallets de Plumavit...
            </div>
          ) : (
            <>
              <div>
                <div className="mb-3">
                  <h2 className="text-lg font-bold">Pallets Abiertos en Proceso</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Selecciona un pallet para continuar su avance, incluso si quedó abierto de otro turno.
                  </p>
                </div>

                {palletsEnProceso.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                    No hay pallets abiertos. Inicia uno para comenzar el prensado.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {palletsEnProceso.map((pallet) => {
                      const selected = String(pallet.id_pallet) === selectedPalletId
                      return (
                        <li key={pallet.id_pallet}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPalletId(String(pallet.id_pallet))
                              setError('')
                              setNotice('')
                            }}
                            disabled={saving}
                            aria-pressed={selected}
                            className={`w-full rounded-xl border-2 p-4 text-left transition ${
                              selected
                                ? 'border-indigo-800 bg-indigo-50'
                                : 'border-slate-200 bg-white hover:bg-slate-50'
                            } disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="break-all font-bold">{pallet.codigo_pallet}</span>
                              <span className="shrink-0 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-900">
                                EN PROCESO
                              </span>
                            </span>
                            <BlockMeter blocks={pallet.bloques_actuales} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {selectedPallet && (
                <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-600">Pallet seleccionado</p>
                      <p className="mt-1 break-all text-xl font-bold">{selectedPallet.codigo_pallet}</p>
                    </div>
                    <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-900">
                      EN PROCESO
                    </span>
                  </div>
                  <BlockMeter blocks={selectedPallet.bloques_actuales} />

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
                      onClick={handleSavePartial}
                      disabled={saving}
                      className="min-h-12 w-full rounded-xl border-2 border-slate-300 px-4 text-base font-semibold text-slate-800 transition hover:border-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Guardar Parcial para Siguiente Turno
                    </button>
                  </div>
                </section>
              )}

              <button
                type="button"
                onClick={handleCreatePallet}
                disabled={saving}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-indigo-800 px-5 text-base font-bold text-white transition hover:bg-indigo-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {saving ? (
                  <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="h-5 w-5" aria-hidden="true" />
                )}
                + Iniciar Nuevo Pallet EPS
              </button>
            </>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-lg font-bold">Últimos pallets completos / Bodega Exterior</h2>
          {palletsCerrados.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              Aún no hay pallets completos o trasladados.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {palletsCerrados.map((pallet) => (
                <li key={pallet.id_pallet} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-bold">{pallet.codigo_pallet}</p>
                    <p className="text-sm text-slate-600">{pallet.bloques_actuales} de 9 bloques</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                    pallet.estado === 'BODEGA_EXTERIOR'
                      ? 'bg-blue-100 text-blue-900'
                      : 'bg-emerald-100 text-emerald-900'
                  }`}>
                    {pallet.estado === 'BODEGA_EXTERIOR' ? 'BODEGA EXTERIOR' : 'COMPLETO'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
