import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  QrCode,
  RefreshCw,
  Scale,
  ScanLine,
  Truck,
  Weight,
  X,
} from 'lucide-react'
import { supabase, supabaseConfigurationError } from '../lib/supabaseClient'

const EMPTY_VALUE = ''

const numberFormat = new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 2,
})

function formatKg(value) {
  return `${numberFormat.format(Number(value) || 0)} kg`
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error?.message === 'string') return error.message
  return 'Ocurrió un error inesperado.'
}

async function loadAvailableBins() {
  const [binsResult, pendingPesajesResult] = await Promise.all([
    supabase
      .from('bins_maestro')
      .select('id_bin, codigo_qr, tara_kg, estado')
      .order('codigo_qr'),
    supabase
      .from('pesajes_scrap')
      .select('id_bin')
      .eq('estado_consumo', 'EN_ESPERA_HORNO'),
  ])

  if (binsResult.error) throw binsResult.error
  if (pendingPesajesResult.error) throw pendingPesajesResult.error

  const binsConPesajeActivo = new Set(
    (pendingPesajesResult.data ?? []).map((pesaje) => String(pesaje.id_bin)),
  )

  return (binsResult.data ?? []).filter(
    (bin) => bin.estado === 'DISPONIBLE' && !binsConPesajeActivo.has(String(bin.id_bin)),
  )
}

async function loadRecentPesajes() {
  const { data, error: queryError } = await supabase
    .from('pesajes_scrap')
    .select(`
      id_pesaje,
      id_bin,
      id_tipo_residuo,
      peso_bruto_kg,
      tara_aplicada_kg,
      estado_consumo,
      bins_maestro ( codigo_qr ),
      tipos_residuo ( codigo, nombre )
    `)
    .eq('estado_consumo', 'EN_ESPERA_HORNO')
    .order('id_pesaje', { ascending: false })
    .limit(5)

  if (queryError) throw queryError
  return data ?? []
}

export default function MolinoScrap({ user }) {
  const [bins, setBins] = useState([])
  const [tiposResiduo, setTiposResiduo] = useState([])
  const [pesajes, setPesajes] = useState([])
  const [selectedBinId, setSelectedBinId] = useState(EMPTY_VALUE)
  const [selectedTipoId, setSelectedTipoId] = useState(EMPTY_VALUE)
  const [pesoBruto, setPesoBruto] = useState(EMPTY_VALUE)
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedBin = useMemo(
    () => bins.find((bin) => String(bin.id_bin) === selectedBinId),
    [bins, selectedBinId],
  )

  const tare = Number(selectedBin?.tara_kg) || 0
  const grossWeight = Number(pesoBruto)
  const netWeight = pesoBruto === EMPTY_VALUE ? null : grossWeight - tare
  const weightIsValid = Number.isFinite(grossWeight) && grossWeight > tare

  const cargarDatos = useCallback(async () => {
    if (!supabase) {
      setError(supabaseConfigurationError)
      setLoading(false)
      return false
    }

    try {
      const [availableBins, tiposResult, latestPesajes] = await Promise.all([
        loadAvailableBins(),
        supabase
          .from('tipos_residuo')
          .select('id_tipo_residuo, codigo, nombre')
          .neq('codigo', 'EPS-BLOQ')
          .order('nombre'),
        loadRecentPesajes(),
      ])

      if (tiposResult.error) throw tiposResult.error

      setBins(availableBins)
      setSelectedBinId((current) => (
        availableBins.some((bin) => String(bin.id_bin) === current) ? current : EMPTY_VALUE
      ))
      setTiposResiduo(tiposResult.data ?? [])
      setPesajes(latestPesajes)
      setError('')
      return true
    } catch (loadError) {
      setError(`No se pudieron cargar bins y pesajes: ${getErrorMessage(loadError)}`)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') cargarDatos()
    }

    window.addEventListener('focus', cargarDatos)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const channel = supabase
      ?.channel('molino-bins-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bins_maestro' }, cargarDatos)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pesajes_scrap' }, cargarDatos)
      .subscribe((status, subscriptionError) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError(`No se pudo mantener la sincronización en tiempo real: ${getErrorMessage(subscriptionError)}`)
        }
      })

    async function initialLoad() {
      await cargarDatos()
    }

    initialLoad()

    return () => {
      window.removeEventListener('focus', cargarDatos)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (channel) supabase.removeChannel(channel)
    }
  }, [cargarDatos])

  useEffect(() => {
    if (!scanning) return undefined

    let active = true
    let html5QrCode
    let startupPromise
    let handled = false

    async function startScanner() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (!active) return

        html5QrCode = new Html5Qrcode('molino-qr-reader')
        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            if (!active || handled) return
            handled = true
            const code = decodedText.trim().toUpperCase()
            const bin = bins.find((item) => item.codigo_qr.toUpperCase() === code)

            setScanning(false)
            if (!bin) {
              setError(`El código ${code} no corresponde a un bin disponible para pesar.`)
              return
            }

            setError('')
            setSelectedBinId(String(bin.id_bin))
            setNotice(`Bin ${bin.codigo_qr} seleccionado.`)
          },
        )
      } catch (scannerError) {
        if (!active) return
        setError(`No se pudo iniciar la cámara para escanear: ${getErrorMessage(scannerError)}`)
        setScanning(false)
      }
    }

    startupPromise = startScanner()

    return () => {
      active = false
      if (html5QrCode) {
        startupPromise.then(async () => {
          try {
            if (html5QrCode.isScanning) await html5QrCode.stop()
            html5QrCode.clear()
          } catch (scannerError) {
          console.error('No se pudo cerrar el escáner QR del molino:', scannerError)
          }
        })
      }
    }
  }, [bins, scanning])

  async function refreshAfterSave() {
    return await cargarDatos()
      ? ''
      : 'No se pudieron actualizar los bins disponibles y los últimos pesajes.'
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await cargarDatos()
    } finally {
      setRefreshing(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setNotice('')

    if (!supabase) {
      setError(supabaseConfigurationError)
      return
    }
    if (!selectedBin) {
      setError('Selecciona un bin disponible antes de guardar el pesaje.')
      return
    }
    if (selectedBin.estado !== 'DISPONIBLE') {
      setError(`El bin ${selectedBin.codigo_qr} no está disponible para un nuevo pesaje.`)
      return
    }
    if (!selectedTipoId) {
      setError('Selecciona un tipo de residuo.')
      return
    }
    if (!weightIsValid) {
      setError(`El peso bruto debe ser mayor que la tara del bin (${formatKg(tare)}).`)
      return
    }

    setSaving(true)
    const pesajeNuevo = {
      id_bin: selectedBin.id_bin,
      id_tipo_residuo: selectedTipoId,
      peso_bruto_kg: grossWeight,
      tara_aplicada_kg: tare,
      estado_consumo: 'EN_ESPERA_HORNO',
    }

    let pesajeInsertado
    try {
      const { data, error: insertError } = await supabase
        .from('pesajes_scrap')
        .insert(pesajeNuevo)
        .select()
        .single()

      if (insertError) throw insertError
      pesajeInsertado = data
    } catch (insertError) {
      setError(`No se pudo registrar el pesaje: ${getErrorMessage(insertError)}`)
      setSaving(false)
      return
    }

    setBins((current) => current.map((bin) => (
      bin.id_bin === selectedBin.id_bin ? { ...bin, estado: 'CARGADO' } : bin
    )))

    let binActualizado
    try {
      const { data, error: updateError } = await supabase
        .from('bins_maestro')
        .update({ estado: 'CARGADO' })
        .eq('id_bin', selectedBin.id_bin)
        .select('id_bin, codigo_qr, tara_kg, estado')
        .single()

      if (updateError) throw updateError
      binActualizado = data
    } catch (updateError) {
      setNotice('')
      const updateMessage = getErrorMessage(updateError)
      const refreshError = await refreshAfterSave()
      setError(
        `El pesaje se registró, pero no se pudo marcar el bin como CARGADO. No reutilices ${selectedBin.codigo_qr} hasta verificar su estado: ${updateMessage}${refreshError ? ` Además, falló la actualización: ${refreshError}` : ''}`,
      )
      setSaving(false)
      return
    }

    let auditError
    try {
      const { error: logError } = await supabase
        .from('logs_auditoria')
        .insert({
          tabla_afectada: 'pesajes_scrap',
          id_registro: Number(pesajeInsertado?.id_pesaje) || 0,
          operacion: 'INSERT',
          datos_nuevos: {
            pesaje: pesajeInsertado,
            bin: binActualizado,
          },
          usuario_nombre: user.nombre_completo,
        })
      auditError = logError
    } catch (auditRequestError) {
      auditError = auditRequestError
    }

    setSelectedBinId(EMPTY_VALUE)
    setSelectedTipoId(EMPTY_VALUE)
    setPesoBruto(EMPTY_VALUE)

    const refreshError = await refreshAfterSave()
    if (auditError) {
      setError(
        `El pesaje y el bin se guardaron, pero falló el registro de auditoría: ${getErrorMessage(auditError)}${refreshError ? ` Además, falló la actualización de la lista: ${refreshError}` : ''}`,
      )
    } else if (refreshError) {
      setError(`El pesaje y el bin se guardaron, pero no se pudo actualizar la lista: ${refreshError}`)
    } else {
      setNotice('Pesaje registrado y bin marcado como CARGADO.')
    }

    setSaving(false)
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="rounded-2xl bg-orange-800 p-5 text-white shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/15 p-3" aria-hidden="true">
              <Scale className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-medium text-orange-100">GreenSpot · Preparación de scrap</p>
              <h1 className="text-2xl font-bold tracking-tight">Trituradora / Molino</h1>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-2 text-sm text-orange-100">
            <Truck className="h-4 w-4" aria-hidden="true" />
            Recepción y pesaje de bins para horno
          </p>
        </header>

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
          <h2 className="mb-5 text-lg font-bold">Nuevo pesaje</h2>
          {loading ? (
            <div className="flex items-center gap-3 py-8 text-slate-600" role="status">
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
              Cargando bins y tipos de residuo...
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="id_bin" className="mb-2 block text-sm font-semibold">
                      Bin
                    </label>
                    <select
                      id="id_bin"
                      name="id_bin"
                      required
                      value={selectedBinId}
                      onChange={(event) => {
                        setSelectedBinId(event.target.value)
                        setError('')
                        setNotice('')
                      }}
                      className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-orange-700 focus:ring-2 focus:ring-orange-700/20"
                    >
                      <option value="">Selecciona un bin</option>
                      {bins.map((bin) => (
                        <option
                          key={bin.id_bin}
                          value={bin.id_bin}
                          disabled={bin.estado !== 'DISPONIBLE'}
                        >
                          {bin.codigo_qr} · Tara {formatKg(bin.tara_kg)} · {bin.estado}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={loading || refreshing || saving || !supabase}
                    aria-label="Actualizar bins y últimos pesajes"
                    className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                    Actualizar
                  </button>
                </div>
                {selectedBin && (
                  <p className="mt-2 text-sm text-slate-600">
                    Tara aplicada: <strong>{formatKg(tare)}</strong>
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setError('')
                  setNotice('')
                  setScanning((current) => !current)
                }}
                disabled={loading || saving || !supabase}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-orange-800 px-5 text-base font-bold text-orange-900 transition hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {scanning ? (
                  <>
                    <ScanLine className="h-5 w-5" aria-hidden="true" />
                    Detener escaneo
                  </>
                ) : (
                  <>
                    <QrCode className="h-5 w-5" aria-hidden="true" />
                    Escanear QR del Bin
                  </>
                )}
              </button>

              {scanning && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
                  <section
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="molino-scanner-title"
                    className="w-full max-w-md space-y-4 rounded-2xl bg-white p-4 shadow-xl"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 id="molino-scanner-title" className="font-bold">Escanear QR del Bin</h3>
                      <button
                        type="button"
                        onClick={() => setScanning(false)}
                        aria-label="Cerrar escáner QR"
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 text-slate-800"
                      >
                        <X className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>
                    <div
                      id="molino-qr-reader"
                      className="overflow-hidden rounded-xl border border-slate-200"
                      aria-label="Cámara trasera para escanear el QR del bin"
                    />
                    <p className="text-sm text-slate-600">Apunta la cámara trasera al código del bin.</p>
                  </section>
                </div>
              )}

              <div>
                <label htmlFor="id_tipo_residuo" className="mb-2 block text-sm font-semibold">
                  Tipo de residuo
                </label>
                <select
                  id="id_tipo_residuo"
                  name="id_tipo_residuo"
                  required
                  value={selectedTipoId}
                  onChange={(event) => setSelectedTipoId(event.target.value)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-orange-700 focus:ring-2 focus:ring-orange-700/20"
                >
                  <option value="">Selecciona un residuo</option>
                  {tiposResiduo.map((tipo) => (
                    <option key={tipo.id_tipo_residuo} value={tipo.id_tipo_residuo}>
                      {tipo.codigo} · {tipo.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="peso_bruto_kg" className="mb-2 block text-sm font-semibold">
                  Peso bruto (kg)
                </label>
                <input
                  id="peso_bruto_kg"
                  name="peso_bruto_kg"
                  type="number"
                  inputMode="decimal"
                  min={selectedBin ? `${tare + Number.EPSILON}` : '0'}
                  step="any"
                  required
                  value={pesoBruto}
                  onChange={(event) => setPesoBruto(event.target.value)}
                  placeholder="0"
                  className="min-h-14 w-full rounded-xl border border-slate-300 px-4 text-2xl font-bold outline-none focus:border-orange-700 focus:ring-2 focus:ring-orange-700/20"
                />
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <p className="flex items-center gap-2 text-sm text-slate-600">
                  <Weight className="h-4 w-4" aria-hidden="true" />
                  Peso neto estimado
                </p>
                <p className={`mt-1 text-2xl font-bold ${
                  netWeight !== null && netWeight > 0 ? 'text-emerald-800' : 'text-slate-500'
                }`}>
                  {netWeight === null ? '—' : formatKg(netWeight)}
                </p>
                {selectedBin && (
                  <p className="mt-1 text-xs text-slate-500">
                    Peso bruto menos tara del bin ({formatKg(tare)})
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={
                  saving
                  || loading
                  || !supabase
                  || !selectedBin
                  || selectedBin.estado !== 'DISPONIBLE'
                  || !selectedTipoId
                  || !weightIsValid
                }
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-orange-800 px-5 text-base font-bold text-white transition hover:bg-orange-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {saving ? (
                  <>
                    <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                    Guardando pesaje...
                  </>
                ) : (
                  <>
                    <Scale className="h-5 w-5" aria-hidden="true" />
                    Guardar pesaje
                  </>
                )}
              </button>
            </form>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-lg font-bold">Últimos pesajes · En espera de horno</h2>
          {pesajes.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              Aún no hay pesajes en espera de horno.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {pesajes.map((pesaje, index) => {
                const pesajeNet = Number(pesaje.peso_bruto_kg) - Number(pesaje.tara_aplicada_kg)
                return (
                  <li
                    key={pesaje.id_pesaje ?? `${pesaje.id_bin}-${index}`}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-bold">
                        {pesaje.bins_maestro?.codigo_qr ?? 'Bin'}
                        <span className="font-normal text-slate-500"> · {pesaje.tipos_residuo?.codigo}</span>
                      </p>
                      <p className="truncate text-sm text-slate-600">{pesaje.tipos_residuo?.nombre}</p>
                      <p className="mt-1 text-xs font-medium text-amber-800">{pesaje.estado_consumo}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-bold">{formatKg(pesajeNet)}</p>
                      <p className="text-xs text-slate-500">neto</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
