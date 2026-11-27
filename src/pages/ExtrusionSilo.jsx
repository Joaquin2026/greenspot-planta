import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Flame,
  LoaderCircle,
  Scale,
  Tag,
} from 'lucide-react'
import { supabase, supabaseConfigurationError } from '../lib/supabaseClient'

const colors = ['Negro', 'Gris', 'Azul', 'Natural']
const steps = ['Bins a horno', 'Pesaje maxisaco', 'Merma y rótulo']
const numberFormat = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 })

function formatKg(value) {
  return `${numberFormat.format(Number(value) || 0)} kg`
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error?.message === 'string') return error.message
  return 'Ocurrió un error inesperado.'
}

function getBinLabel(pesaje) {
  return pesaje.bins_maestro?.codigo_qr ?? 'Bin sin código'
}

export default function ExtrusionSilo({ user }) {
  const [pendingPesajes, setPendingPesajes] = useState([])
  const [corridasRecientes, setCorridasRecientes] = useState([])
  const [tiposResiduo, setTiposResiduo] = useState([])
  const [tipoMaterialId, setTipoMaterialId] = useState('')
  const [binsSeleccionados, setBinsSeleccionados] = useState([])
  const [kilosPelletMaxisaco, setKilosPelletMaxisaco] = useState('')
  const [colorPellet, setColorPellet] = useState('Negro')
  const [causalTecnica, setCausalTecnica] = useState('')
  const [step, setStep] = useState(1)
  const [ultimoValeEmitido, setUltimoValeEmitido] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const tipoMaterial = useMemo(
    () => tiposResiduo.find((tipo) => String(tipo.id_tipo_residuo) === tipoMaterialId),
    [tipoMaterialId, tiposResiduo],
  )

  const binsCompatibles = useMemo(
    () => pendingPesajes.filter(
      (pesaje) => String(pesaje.id_tipo_residuo) === tipoMaterialId,
    ),
    [pendingPesajes, tipoMaterialId],
  )

  const binsOtroPolimero = useMemo(
    () => pendingPesajes.filter(
      (pesaje) => tipoMaterialId && String(pesaje.id_tipo_residuo) !== tipoMaterialId,
    ),
    [pendingPesajes, tipoMaterialId],
  )

  const selectedPesajes = useMemo(
    () => binsCompatibles.filter((pesaje) => binsSeleccionados.includes(String(pesaje.id_pesaje))),
    [binsCompatibles, binsSeleccionados],
  )

  const kilosScrapEntrada = useMemo(
    () => selectedPesajes.reduce(
      (total, pesaje) => total + Number(pesaje.peso_bruto_kg) - Number(pesaje.tara_aplicada_kg),
      0,
    ),
    [selectedPesajes],
  )

  const pelletWeight = Number(kilosPelletMaxisaco)
  const porcentajeMerma = kilosScrapEntrada > 0 && kilosPelletMaxisaco !== ''
    ? ((kilosScrapEntrada - pelletWeight) / kilosScrapEntrada) * 100
    : null
  const mermaRequiereCausal = porcentajeMerma !== null && porcentajeMerma > 8
  const pelletWeightValid = Number.isFinite(pelletWeight)
    && pelletWeight > 0
    && pelletWeight <= kilosScrapEntrada

  async function cargarDatos() {
    if (!supabase) {
      setError(supabaseConfigurationError)
      setLoading(false)
      return false
    }

    setLoading(true)
    try {
      const [tiposResult, pesajesResult, corridasResult] = await Promise.all([
        supabase
          .from('tipos_residuo')
          .select('id_tipo_residuo, codigo, nombre')
          .neq('codigo', 'EPS-BLOQ')
          .order('nombre'),
        supabase
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
          .order('id_pesaje', { ascending: true }),
        supabase
          .from('corridas_extrusion')
          .select(`
            id_corrida,
            numero_vale,
            id_tipo_residuo,
            kilos_scrap_entrada,
            kilos_pellet_maxisaco,
            color_pellet,
            porcentaje_merma,
            tipos_residuo ( nombre )
          `)
          .order('id_corrida', { ascending: false })
          .limit(5),
      ])

      if (tiposResult.error) throw tiposResult.error
      if (pesajesResult.error) throw pesajesResult.error
      if (corridasResult.error) throw corridasResult.error

      setTiposResiduo(tiposResult.data ?? [])
      setPendingPesajes(pesajesResult.data ?? [])
      setCorridasRecientes(corridasResult.data ?? [])
      return true
    } catch (loadError) {
      setError(`No se pudieron cargar los datos de horno: ${getErrorMessage(loadError)}`)
      return false
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function initialLoad() {
      await cargarDatos()
    }

    initialLoad()
  }, [])

  function toggleBin(idBin) {
    const id = String(idBin)
    setBinsSeleccionados((current) => (
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id]
    ))
  }

  function handleTipoMaterialChange(event) {
    setTipoMaterialId(event.target.value)
    setBinsSeleccionados([])
    setError('')
    setNotice('')
  }

  function goToStepTwo() {
    setError('')
    setNotice('')
    setStep(2)
  }

  function goToStepThree() {
    setError('')
    setNotice('')
    setStep(3)
  }

  async function handleConfirm() {
    setError('')
    setNotice('')

    if (!supabase) {
      setError(supabaseConfigurationError)
      return
    }
    if (selectedPesajes.length === 0 || kilosScrapEntrada <= 0) {
      setError('Selecciona al menos un bin con peso neto válido.')
      setStep(1)
      return
    }
    if (!tipoMaterial) {
      setError('Selecciona el tipo de material de la corrida.')
      setStep(1)
      return
    }
    if (!pelletWeightValid) {
      setError('Los kilos del maxisaco deben ser mayores que cero y no superar los kilos de scrap de entrada.')
      setStep(2)
      return
    }
    if (!colorPellet) {
      setError('Selecciona el color del pellet.')
      setStep(2)
      return
    }
    if (mermaRequiereCausal && !causalTecnica.trim()) {
      setError('La merma supera el 8%. Debes indicar una causal técnica antes de guardar.')
      setStep(3)
      return
    }

    const valeDate = new Date()
    const corridaNueva = {
      id_tipo_residuo: tipoMaterial.id_tipo_residuo,
      kilos_scrap_entrada: kilosScrapEntrada,
      kilos_pellet_maxisaco: pelletWeight,
      color_pellet: colorPellet,
      porcentaje_merma: porcentajeMerma,
      causal_tecnica: causalTecnica.trim() || null,
    }
    const idsPesaje = selectedPesajes.map((pesaje) => pesaje.id_pesaje)
    const idsBin = [...new Set(selectedPesajes.map((pesaje) => pesaje.id_bin))]
    let numeroVale = ''
    let corridaGuardada = null
    let etapa = 'consultar el correlativo de corridas'
    setSaving(true)

    try {
      const { data: ultimaCorrida, error: lastRunError } = await supabase
        .from('corridas_extrusion')
        .select('id_corrida')
        .order('id_corrida', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (lastRunError) throw lastRunError

      const siguienteCorrelativo = (Number(ultimaCorrida?.id_corrida) || 0) + 1
      const valeBase = `VALE-${String(siguienteCorrelativo).padStart(4, '0')}`
      let corrida
      let duplicateError

      etapa = 'crear la corrida de extrusión'
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const now = new Date()
        const horaMinuto = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
        const sufijoColision = `${horaMinuto}${Math.random().toString(36).slice(2, 4).toUpperCase()}`
        numeroVale = attempt === 0 ? valeBase : `${valeBase}-${sufijoColision}`

        const { data, error: corridaError } = await supabase
          .from('corridas_extrusion')
          .insert({ ...corridaNueva, numero_vale: numeroVale })
          .select()
          .single()

        if (!corridaError) {
          corrida = data
          duplicateError = null
          break
        }
        if (corridaError.code !== '23505') throw corridaError
        duplicateError = corridaError
      }

      if (!corrida) throw duplicateError
      corridaGuardada = corrida

      etapa = 'actualizar los pesajes seleccionados'
      const { data: pesajesActualizados, error: pesajesError } = await supabase
        .from('pesajes_scrap')
        .update({ estado_consumo: 'EXTRUSIONADO' })
        .in('id_pesaje', idsPesaje)
        .eq('estado_consumo', 'EN_ESPERA_HORNO')
        .select('id_bin, id_tipo_residuo, peso_bruto_kg, tara_aplicada_kg, estado_consumo')

      if (pesajesError) throw pesajesError
      if ((pesajesActualizados ?? []).length !== selectedPesajes.length) {
        throw new Error(
          `Se esperaban ${selectedPesajes.length} pesajes, pero se actualizaron ${(pesajesActualizados ?? []).length}. Verifica los registros antes de repetir la operación.`,
        )
      }

      etapa = 'liberar los bins seleccionados'
      const { data: binsLiberados, error: binsError } = await supabase
        .from('bins_maestro')
        .update({ estado: 'DISPONIBLE' })
        .in('id_bin', idsBin)
        .eq('estado', 'CARGADO')
        .select('id_bin, codigo_qr, estado')

      if (binsError) throw binsError
      if ((binsLiberados ?? []).length !== idsBin.length) {
        throw new Error(
          `Se esperaban ${idsBin.length} bins liberados, pero se actualizaron ${(binsLiberados ?? []).length}. Verifica los estados de los bins.`,
        )
      }

      etapa = 'registrar la auditoría'
      const { error: auditError } = await supabase
        .from('logs_auditoria')
        .insert({
          tabla_afectada: 'corridas_extrusion',
          id_registro: Number(corrida?.id_corrida) || 0,
          operacion: 'INSERT',
          datos_nuevos: {
            corrida,
            material: {
              id_tipo_residuo: tipoMaterial.id_tipo_residuo,
              nombre: tipoMaterial.nombre,
            },
            pesajes: pesajesActualizados,
            bins: binsLiberados,
          },
          usuario_nombre: user.nombre_completo,
        })

      if (auditError) throw auditError

      setUltimoValeEmitido({
        numeroVale,
        material: tipoMaterial.nombre,
        color: colorPellet,
        kilosNetos: pelletWeight,
        fecha: valeDate.toLocaleString('es-CL'),
        merma: porcentajeMerma,
      })
      setTipoMaterialId('')
      setBinsSeleccionados([])
      setKilosPelletMaxisaco('')
      setColorPellet('Negro')
      setCausalTecnica('')
      setStep(1)
      setNotice(`Corrida ${numeroVale} guardada. Los bins quedaron disponibles.`)

      const dataReloaded = await cargarDatos()
      if (!dataReloaded) {
        setError((message) => `La corrida se guardó, pero no se pudo actualizar la lista. ${message}`)
      }
    } catch (saveError) {
      const partialStatus = corridaGuardada
        ? `El vale ${numeroVale} ya fue creado; `
        : ''
      setError(`${partialStatus}no se pudo ${etapa}: ${getErrorMessage(saveError)}`)
      setBinsSeleccionados([])
      await cargarDatos()
    } finally {
      setSaving(false)
    }
  }

  const canContinueToStepTwo = Boolean(tipoMaterialId)
    && selectedPesajes.length > 0
    && kilosScrapEntrada > 0
  const canContinueToStepThree = pelletWeightValid && Boolean(colorPellet)
  const canConfirm = canContinueToStepThree
    && (!mermaRequiereCausal || Boolean(causalTecnica.trim()))

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="rounded-2xl bg-rose-900 p-5 text-white shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/15 p-3" aria-hidden="true">
              <Flame className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-medium text-rose-100">GreenSpot · Línea de proceso</p>
              <h1 className="text-2xl font-bold tracking-tight">Horno, Extrusión y Silo</h1>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-2 text-sm text-rose-100">
            <Scale className="h-4 w-4" aria-hidden="true" />
            Consumo de scrap y control de maxisaco
          </p>
        </header>

        {ultimoValeEmitido && (
          <section
            aria-label="Datos para rotular maxisaco"
            className="rounded-2xl border-4 border-yellow-300 bg-yellow-100 p-5 text-slate-950 shadow-md sm:p-6"
          >
            <p className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-rose-900">
              <Tag className="h-5 w-5" aria-hidden="true" />
              Datos para rotular con plumón en el maxisaco
            </p>
            <p className="mt-4 text-3xl font-black tracking-tight">{ultimoValeEmitido.numeroVale}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="text-xs font-bold uppercase text-slate-600">Material</dt>
                <dd className="mt-1 text-lg font-black">{ultimoValeEmitido.material}</dd>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="text-xs font-bold uppercase text-slate-600">Color</dt>
                <dd className="mt-1 text-lg font-black">{ultimoValeEmitido.color}</dd>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="text-xs font-bold uppercase text-slate-600">Kilos netos</dt>
                <dd className="mt-1 text-lg font-black">{formatKg(ultimoValeEmitido.kilosNetos)}</dd>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="text-xs font-bold uppercase text-slate-600">Fecha</dt>
                <dd className="mt-1 text-sm font-bold">{ultimoValeEmitido.fecha}</dd>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="text-xs font-bold uppercase text-slate-600">Merma térmica</dt>
                <dd className="mt-1 text-lg font-black">{numberFormat.format(ultimoValeEmitido.merma)}%</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => {
                setUltimoValeEmitido(null)
                setTipoMaterialId('')
                setBinsSeleccionados([])
                setKilosPelletMaxisaco('')
                setColorPellet('Negro')
                setCausalTecnica('')
                setStep(1)
                setError('')
                setNotice('')
              }}
              className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-base font-bold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
            >
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              Cerrar Vale / Nueva Corrida
            </button>
          </section>
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

        <ol className="grid grid-cols-3 gap-2" aria-label="Pasos de la corrida">
          {steps.map((label, index) => {
            const stepNumber = index + 1
            const isCurrent = step === stepNumber
            const isComplete = step > stepNumber
            return (
              <li
                key={label}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex min-h-14 items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold sm:px-3 sm:text-sm ${
                  isCurrent
                    ? 'bg-rose-900 text-white'
                    : isComplete
                      ? 'bg-emerald-100 text-emerald-900'
                      : 'bg-white text-slate-500'
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/10">
                  {isComplete ? <Check className="h-4 w-4" aria-hidden="true" /> : stepNumber}
                </span>
                <span>{label}</span>
              </li>
            )
          })}
        </ol>

        {loading ? (
          <section className="flex items-center gap-3 rounded-2xl bg-white p-6 text-slate-600 shadow-sm" role="status">
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            Cargando bins en espera de horno...
          </section>
        ) : (
          <>
            {step === 1 && (
              <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm sm:p-6">
                <div>
                  <h2 className="text-lg font-bold">1. Bins a horno</h2>
                  <p className="mt-1 text-sm text-slate-600">Elige un material para evitar mezclar polímeros.</p>
                </div>

                <div>
                  <label htmlFor="tipo_material_corrida" className="mb-2 block text-sm font-semibold">
                    Tipo de material de la corrida
                  </label>
                  <select
                    id="tipo_material_corrida"
                    name="tipo_material_corrida"
                    required
                    value={tipoMaterialId}
                    onChange={handleTipoMaterialChange}
                    disabled={saving}
                    className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-rose-800 focus:ring-2 focus:ring-rose-800/20"
                  >
                    <option value="">Selecciona un tipo de material</option>
                    {tiposResiduo.map((tipo) => (
                      <option key={tipo.id_tipo_residuo} value={tipo.id_tipo_residuo}>
                        {tipo.codigo} · {tipo.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                {pendingPesajes.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                    No hay bins en espera de horno.
                  </p>
                ) : !tipoMaterialId ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                    Selecciona el material para mostrar los bins compatibles.
                  </p>
                ) : binsCompatibles.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                    No hay bins en espera para {tipoMaterial?.nombre}.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {binsCompatibles.map((pesaje) => {
                      const id = String(pesaje.id_pesaje)
                      const checked = binsSeleccionados.includes(id)
                      const netWeight = Number(pesaje.peso_bruto_kg) - Number(pesaje.tara_aplicada_kg)
                      return (
                        <li key={pesaje.id_pesaje}>
                          <label className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                            checked
                              ? 'border-rose-800 bg-rose-50'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={saving}
                              onChange={() => toggleBin(pesaje.id_pesaje)}
                              className="h-6 w-6 shrink-0 accent-rose-800"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-bold">{getBinLabel(pesaje)}</span>
                              <span className="block truncate text-sm text-slate-600">
                                {pesaje.tipos_residuo?.codigo} · {pesaje.tipos_residuo?.nombre}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block font-bold">{formatKg(netWeight)}</span>
                              <span className="block text-xs text-slate-500">neto</span>
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {tipoMaterialId && binsOtroPolimero.length > 0 && (
                  <aside className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <p className="font-bold text-amber-950">
                      Bins en planta de otro polímero — bloqueados para evitar contaminación del lote
                    </p>
                    <ul className="mt-3 space-y-2">
                      {binsOtroPolimero.map((pesaje) => (
                        <li
                          key={pesaje.id_pesaje}
                          className="flex items-center justify-between gap-3 rounded-lg bg-white/70 p-3 text-sm text-slate-600"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{getBinLabel(pesaje)}</span>
                            <span className="block truncate">
                              {pesaje.tipos_residuo?.codigo} · {pesaje.tipos_residuo?.nombre}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold">
                            {formatKg(Number(pesaje.peso_bruto_kg) - Number(pesaje.tara_aplicada_kg))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </aside>
                )}

                <div className="flex items-center justify-between rounded-xl bg-slate-100 p-4">
                  <span className="text-sm font-semibold text-slate-700">
                    Acumulado neto · {selectedPesajes.length} bin{selectedPesajes.length === 1 ? '' : 's'}
                  </span>
                  <span className="text-lg font-black text-rose-900">{formatKg(kilosScrapEntrada)}</span>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-slate-700">Referencia maxisaco estándar</span>
                    <span className="font-bold text-slate-900">2.500 kg</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Acumulado comparado con maxisaco estándar"
                    aria-valuemin={0}
                    aria-valuemax={2500}
                    aria-valuenow={Math.max(0, Math.min(kilosScrapEntrada, 2500))}
                    className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200"
                  >
                    <div
                      className="h-full rounded-full bg-rose-800 transition-all"
                      style={{ width: `${Math.max(0, Math.min((kilosScrapEntrada / 2500) * 100, 100))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-right text-xs text-slate-500">
                    {numberFormat.format(Math.max(0, Math.min((kilosScrapEntrada / 2500) * 100, 100)))}% de referencia
                  </p>
                </div>

                <button
                  type="button"
                  onClick={goToStepTwo}
                  disabled={!canContinueToStepTwo || saving}
                  className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-rose-900 px-5 text-base font-bold text-white transition hover:bg-rose-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  Continuar al pesaje
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </section>
            )}

            {step === 2 && (
              <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm sm:p-6">
                <div>
                  <h2 className="text-lg font-bold">2. Pesaje maxisaco bajo silo</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {tipoMaterial?.nombre} · Entrada de scrap: {formatKg(kilosScrapEntrada)}
                  </p>
                </div>

                <div>
                  <label htmlFor="kilos_pellet_maxisaco" className="mb-2 block text-sm font-semibold">
                    Kilos netos de pellet
                  </label>
                  <input
                    id="kilos_pellet_maxisaco"
                    name="kilos_pellet_maxisaco"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={kilosScrapEntrada}
                    step="any"
                    required
                    value={kilosPelletMaxisaco}
                    onChange={(event) => setKilosPelletMaxisaco(event.target.value)}
                    placeholder="0"
                    className="min-h-14 w-full rounded-xl border border-slate-300 px-4 text-2xl font-bold outline-none focus:border-rose-800 focus:ring-2 focus:ring-rose-800/20"
                  />
                </div>

                <div>
                  <label htmlFor="color_pellet" className="mb-2 block text-sm font-semibold">
                    Color del pellet
                  </label>
                  <select
                    id="color_pellet"
                    name="color_pellet"
                    required
                    value={colorPellet}
                    onChange={(event) => setColorPellet(event.target.value)}
                    className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-rose-800 focus:ring-2 focus:ring-rose-800/20"
                  >
                    <option value="">Selecciona un color</option>
                    {colors.map((color) => <option key={color} value={color}>{color}</option>)}
                  </select>
                </div>

                {kilosPelletMaxisaco !== '' && !pelletWeightValid && (
                  <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status">
                    Ingresa un peso mayor que cero y no superior a {formatKg(kilosScrapEntrada)}.
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-slate-300 px-3 font-semibold text-slate-800"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={goToStepThree}
                    disabled={!canContinueToStepThree}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-rose-900 px-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    Ver merma
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </section>
            )}

            {step === 3 && (
              <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm sm:p-6">
                <div>
                  <h2 className="text-lg font-bold">3. Merma térmica y rotulado</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {tipoMaterial?.nombre} · Revisa los valores antes de confirmar la corrida.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-100 p-4">
                    <p className="text-xs font-semibold text-slate-600">Scrap entrada</p>
                    <p className="mt-1 text-lg font-black">{formatKg(kilosScrapEntrada)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-100 p-4">
                    <p className="text-xs font-semibold text-slate-600">Pellet maxisaco</p>
                    <p className="mt-1 text-lg font-black">{formatKg(pelletWeight)}</p>
                  </div>
                </div>

                <div className={`rounded-xl p-5 ${
                  mermaRequiereCausal ? 'border-2 border-red-500 bg-red-50' : 'bg-emerald-50'
                }`}>
                  <p className={`text-sm font-semibold ${
                    mermaRequiereCausal ? 'text-red-800' : 'text-emerald-900'
                  }`}>
                    Porcentaje de merma térmica
                  </p>
                  <p className={`mt-1 text-4xl font-black ${
                    mermaRequiereCausal ? 'text-red-700' : 'text-emerald-800'
                  }`}>
                    {porcentajeMerma === null ? '—' : `${numberFormat.format(porcentajeMerma)}%`}
                  </p>
                </div>

                {mermaRequiereCausal && (
                  <div role="alert" className="space-y-3 rounded-xl border-2 border-red-500 bg-red-50 p-4 text-red-900">
                    <p className="flex items-start gap-2 font-bold">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                      La merma supera el 8%. Es obligatorio registrar la causal técnica.
                    </p>
                    <div>
                      <label htmlFor="causal_tecnica" className="mb-2 block text-sm font-bold">
                        Causal técnica
                      </label>
                      <textarea
                        id="causal_tecnica"
                        name="causal_tecnica"
                        required
                        rows="3"
                        value={causalTecnica}
                        onChange={(event) => setCausalTecnica(event.target.value)}
                        placeholder="Describe la causa de la merma..."
                        className="w-full rounded-xl border border-red-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-700/20"
                      />
                    </div>
                  </div>
                )}

                <div className="rounded-xl bg-slate-100 p-4">
                  <p className="text-xs font-semibold text-slate-600">Color para rotular</p>
                  <p className="mt-1 font-bold">{colorPellet}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    disabled={saving}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-slate-300 px-3 font-semibold text-slate-800 disabled:opacity-50"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={!canConfirm || saving}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-rose-900 px-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {saving ? (
                      <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                    ) : (
                      <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
                    )}
                    Confirmar corrida
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="text-lg font-bold">Últimas corridas de extrusión</h2>
            <p className="mt-1 text-sm text-slate-600">El material corresponde al tipo registrado en cada corrida.</p>
          </div>
          {corridasRecientes.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Aún no hay corridas registradas.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {corridasRecientes.map((corrida) => {
                const tipo = Array.isArray(corrida.tipos_residuo)
                  ? corrida.tipos_residuo[0]
                  : corrida.tipos_residuo
                const material = tipo?.nombre
                  ?? tiposResiduo.find(
                    (item) => String(item.id_tipo_residuo) === String(corrida.id_tipo_residuo),
                  )?.nombre
                  ?? 'Material no identificado'
                return (
                  <li key={corrida.id_corrida} className="grid gap-2 py-4 sm:grid-cols-2">
                    <div>
                      <p className="font-bold">{corrida.numero_vale || `Corrida ${corrida.id_corrida}`}</p>
                      <p className="mt-1 text-sm font-semibold text-emerald-900">
                        Tipo de Polímero: {material}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm sm:text-right">
                      <p>Scrap entrada: <strong>{formatKg(corrida.kilos_scrap_entrada)}</strong></p>
                      <p>Maxisaco: <strong>{formatKg(corrida.kilos_pellet_maxisaco)}</strong></p>
                      <p>Color: <strong>{corrida.color_pellet || '—'}</strong></p>
                      <p>Merma: <strong>{numberFormat.format(Number(corrida.porcentaje_merma) || 0)}%</strong></p>
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
