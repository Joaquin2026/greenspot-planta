import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Flame,
  LoaderCircle,
  PackageCheck,
  QrCode,
  RefreshCw,
  Scale,
  Tag,
  Truck,
  X,
} from 'lucide-react'
import { supabase, supabaseConfigurationError } from '../lib/supabaseClient'

const colors = ['Negro', 'Gris', 'Azul', 'Natural']
const numberFormat = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 })

function formatKg(value) {
  return `${numberFormat.format(Number(value) || 0)} kg`
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error?.message === 'string') return error.message
  return 'Ocurrió un error inesperado.'
}

function getNetWeight(pesaje) {
  if (
    pesaje.peso_neto_kg !== null
    && pesaje.peso_neto_kg !== undefined
    && Number.isFinite(Number(pesaje.peso_neto_kg))
  ) {
    return Number(pesaje.peso_neto_kg)
  }
  return Math.max(
    0,
    (Number(pesaje.peso_bruto_kg) || 0) - (Number(pesaje.tara_aplicada_kg) || 0),
  )
}

function getRelatedType(row) {
  return Array.isArray(row?.tipos_residuo) ? row.tipos_residuo[0] : row?.tipos_residuo
}

function formatValeSequence(sequence) {
  return `VALE-${String(sequence).padStart(4, '0')}`
}

function getLoggedInUserName(fallbackName) {
  try {
    const storedUser = JSON.parse(localStorage.getItem('greenspot_user') || 'null')
    return storedUser?.nombre_completo || fallbackName || 'Operario'
  } catch {
    return fallbackName || 'Operario'
  }
}

function isMissingColumn(error, column) {
  return (error?.code === '42703' || error?.code === 'PGRST204')
    && error.message?.includes(column)
}

export default function ExtrusionSilo({ user }) {
  const [pendingPesajes, setPendingPesajes] = useState([])
  const [corridasEnLlenado, setCorridasEnLlenado] = useState([])
  const [corridasRecientes, setCorridasRecientes] = useState([])
  const [binsVolcados, setBinsVolcados] = useState([])
  const [binsLoadedRunId, setBinsLoadedRunId] = useState('')
  const [tiposResiduo, setTiposResiduo] = useState([])
  const [tipoMaterialId, setTipoMaterialId] = useState('')
  const [kilosPelletMaxisaco, setKilosPelletMaxisaco] = useState('')
  const [colorPellet, setColorPellet] = useState('Negro')
  const [causalTecnica, setCausalTecnica] = useState('')
  const [ultimoValeEmitido, setUltimoValeEmitido] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingRun, setSavingRun] = useState(false)
  const [cerrandoMaxisaco, setCerrandoMaxisaco] = useState(false)
  const [procesandoBinId, setProcesandoBinId] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const tipoMaterial = useMemo(
    () => tiposResiduo.find((tipo) => String(tipo.id_tipo_residuo) === tipoMaterialId),
    [tipoMaterialId, tiposResiduo],
  )
  const siloActivo = useMemo(
    () => corridasEnLlenado.find(
      (corrida) => String(corrida.id_tipo_residuo) === tipoMaterialId,
    ) ?? null,
    [corridasEnLlenado, tipoMaterialId],
  )
  const maxisacoActivo = siloActivo
  const binsCompatibles = useMemo(
    () => pendingPesajes.filter(
      (pesaje) => String(pesaje.id_tipo_residuo) === tipoMaterialId,
    ),
    [pendingPesajes, tipoMaterialId],
  )
  const kilosEnBinsVolcados = binsVolcados.reduce((total, pesaje) => total + getNetWeight(pesaje), 0)
  const hasKilosAlimentadosColumn = Boolean(siloActivo)
    && Object.prototype.hasOwnProperty.call(siloActivo, 'kilos_scrap_alimentados')
  const binsLoadedForActiveRun = siloActivo
    && binsLoadedRunId === String(siloActivo.id_corrida)
  const kilosAlimentados = hasKilosAlimentadosColumn
    ? Number(siloActivo.kilos_scrap_alimentados) || 0
    : binsLoadedForActiveRun ? kilosEnBinsVolcados : 0
  const pesoPellet = Number(kilosPelletMaxisaco)
  const mermaReal = kilosAlimentados > 0 && kilosPelletMaxisaco !== ''
    ? ((kilosAlimentados - pesoPellet) / kilosAlimentados) * 100
    : null
  const mermaRequiereCausal = mermaReal !== null && mermaReal > 8
  const pesoPelletValido = Number.isFinite(pesoPellet)
    && pesoPellet > 0
    && pesoPellet <= kilosAlimentados

  const cargarDatos = useCallback(async ({ silent = false } = {}) => {
    if (!supabase) {
      setError(supabaseConfigurationError)
      setLoading(false)
      return false
    }

    if (!silent) setLoading(true)
    try {
      const [tiposResult, pesajesResult, activeRunsResult, recentRunsResult] = await Promise.all([
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
            peso_neto_kg,
            estado_consumo,
            bins_maestro ( codigo_qr ),
            tipos_residuo ( codigo, nombre )
          `)
          .eq('estado_consumo', 'EN_ESPERA_HORNO')
          .order('id_pesaje', { ascending: true }),
        supabase
          .from('corridas_extrusion')
          .select('*, tipos_residuo ( codigo, nombre )')
          .eq('estado_stock', 'EN_LLENADO')
          .order('id_corrida', { ascending: false }),
        supabase
          .from('corridas_extrusion')
          .select('*, tipos_residuo ( codigo, nombre )')
          .order('id_corrida', { ascending: false })
          .limit(5),
      ])

      if (tiposResult.error) throw new Error(`Tipos de material: ${tiposResult.error.message}`)
      if (pesajesResult.error) throw new Error(`Bins en espera: ${pesajesResult.error.message}`)
      if (activeRunsResult.error) throw new Error(`Maxisacos en llenado: ${activeRunsResult.error.message}`)
      if (recentRunsResult.error) throw new Error(`Historial de corridas: ${recentRunsResult.error.message}`)

      setTiposResiduo(tiposResult.data ?? [])
      setPendingPesajes(pesajesResult.data ?? [])
      setCorridasEnLlenado(activeRunsResult.data ?? [])
      setCorridasRecientes(recentRunsResult.data ?? [])
      setError('')
      return true
    } catch (loadError) {
      setError(`No se pudieron cargar los datos de horno: ${getErrorMessage(loadError)}`)
      return false
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const cargarBinsVolcados = useCallback(async (runId) => {
    if (!supabase || !runId) {
      setBinsVolcados([])
      setBinsLoadedRunId('')
      return true
    }

    const { data, error: queryError } = await supabase
      .from('pesajes_scrap')
      .select(`
        id_pesaje,
        id_bin,
        peso_bruto_kg,
        tara_aplicada_kg,
        peso_neto_kg,
        bins_maestro ( codigo_qr )
      `)
      .eq('id_corrida', runId)
      .eq('estado_consumo', 'CONSUMIDO_EN_HORNO')
      .order('id_pesaje', { ascending: true })

    if (queryError) {
      console.error('Error al recargar bins volcados en la corrida:', queryError)
      setError(queryError.message)
      return false
    }

    setBinsVolcados(data ?? [])
    setBinsLoadedRunId(String(runId))
    return true
  }, [])

  useEffect(() => {
    async function initialLoad() {
      await cargarDatos()
    }
    initialLoad()
  }, [cargarDatos])

  useEffect(() => {
    async function loadBinsInRun() {
      if (!supabase || !siloActivo) {
        setBinsVolcados([])
        setBinsLoadedRunId('')
        return
      }

      await cargarBinsVolcados(siloActivo.id_corrida)
    }

    loadBinsInRun()
  }, [cargarBinsVolcados, siloActivo])

  const handleVaciarBin = useCallback(async (pesaje) => {
    setError('')
    setNotice('')
    if (!supabase) {
      setError(supabaseConfigurationError)
      return
    }
    if (!maxisacoActivo) {
      setError('Inicia o selecciona un maxisaco en llenado antes de vaciar bins.')
      return
    }
    if (String(pesaje.id_tipo_residuo) !== String(maxisacoActivo.id_tipo_residuo)) {
      setError('El bin no corresponde al polímero del maxisaco activo.')
      return
    }
    if (pesaje.estado_consumo !== 'EN_ESPERA_HORNO') {
      setError('Este pesaje ya no está en espera de horno.')
      return
    }

    const netWeight = Number(pesaje.peso_neto_kg || 0)
    if (netWeight <= 0) {
      setError('El bin no tiene un peso neto válido para vaciar.')
      return
    }

    setProcesandoBinId(String(pesaje.id_pesaje))
    try {
      const { data: pesajeActualizado, error: err1 } = await supabase
        .from('pesajes_scrap')
        .update({
          estado_consumo: 'CONSUMIDO_EN_HORNO',
          id_corrida: maxisacoActivo.id_corrida,
        })
        .eq('id_pesaje', pesaje.id_pesaje)
        .eq('estado_consumo', 'EN_ESPERA_HORNO')
        .select('id_pesaje, id_bin, id_tipo_residuo, peso_bruto_kg, tara_aplicada_kg, estado_consumo, id_corrida')
        .maybeSingle()

      if (err1) throw err1
      if (!pesajeActualizado) {
        throw new Error('El pesaje ya fue procesado por otra estación; actualiza la lista.')
      }

      const { data: binLiberado, error: err2 } = await supabase
        .from('bins_maestro')
        .update({ estado: 'DISPONIBLE' })
        .eq('id_bin', pesaje.id_bin)
        .eq('estado', 'CARGADO')
        .select('id_bin, codigo_qr, estado')
        .maybeSingle()

      if (err2) throw err2
      if (!binLiberado) {
        throw new Error('El pesaje quedó consumido, pero el bin no estaba en estado CARGADO para liberarlo.')
      }

      const nuevoTotal = Number(maxisacoActivo.kilos_scrap_alimentados || 0)
        + Number(pesaje.peso_neto_kg || 0)
      const { data: corridaActualizada, error: err3 } = await supabase
        .from('corridas_extrusion')
        .update({
          kilos_scrap_entrada: nuevoTotal,
          kilos_scrap_alimentados: nuevoTotal,
        })
        .eq('id_corrida', maxisacoActivo.id_corrida)
        .eq('estado_stock', 'EN_LLENADO')
        .select('*')
        .maybeSingle()

      if (err3) throw err3
      if (!corridaActualizada) {
        throw new Error('El bin se consumió y liberó, pero el maxisaco ya no está en llenado.')
      }

      const { error: auditError } = await supabase
        .from('logs_auditoria')
        .insert({
          tabla_afectada: 'pesajes_scrap',
          id_registro: Number(pesajeActualizado.id_pesaje) || 0,
          operacion: 'UPDATE',
          datos_nuevos: {
            pesaje: pesajeActualizado,
            bin: binLiberado,
            corrida: corridaActualizada,
            peso_neto_agregado_kg: netWeight,
          },
          usuario_nombre: user.nombre_completo,
        })

      if (auditError) {
        console.error('Error al registrar auditoría del vaciado del bin:', auditError)
        throw auditError
      }

      setNotice(`${pesaje.bins_maestro?.codigo_qr || 'Bin'} vaciado y liberado. ${formatKg(netWeight)} agregados al ${maxisacoActivo.numero_vale}.`)
      const dashboardReloaded = await cargarDatos({ silent: true })
      const pouredBinsReloaded = await cargarBinsVolcados(maxisacoActivo.id_corrida)
      if (!dashboardReloaded || !pouredBinsReloaded) {
        setNotice('')
      }
    } catch (saveError) {
      console.error('Error al vaciar el bin a Extrusión/Horno y liberar el envase:', saveError)
      const message = getErrorMessage(saveError)
      await cargarDatos({ silent: true })
      const pouredBinsReloaded = await cargarBinsVolcados(maxisacoActivo.id_corrida)
      setError(pouredBinsReloaded ? message : `${message} No se pudo recargar la lista de bins volcados.`)
    } finally {
      setProcesandoBinId('')
    }
  }, [
    cargarBinsVolcados,
    cargarDatos,
    maxisacoActivo,
    user.nombre_completo,
  ])

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

        html5QrCode = new Html5Qrcode('extrusion-qr-reader')
        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            if (!active || handled) return
            handled = true
            const code = decodedText.trim().toUpperCase()
            const pesaje = binsCompatibles.find(
              (item) => item.bins_maestro?.codigo_qr?.toUpperCase() === code,
            )
            setScanning(false)
            if (!pesaje) {
              setError(`El código ${code} no corresponde a un bin en espera del polímero seleccionado.`)
              return
            }
            handleVaciarBin(pesaje)
          },
        )
      } catch (scannerError) {
        if (!active) return
        setError(`No se pudo iniciar el escáner QR: ${getErrorMessage(scannerError)}`)
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
          console.error('No se pudo cerrar el escáner QR de extrusión:', scannerError)
          }
        })
      }
    }
  }, [binsCompatibles, handleVaciarBin, scanning])

  async function iniciarMaxisaco() {
    setError('')
    setNotice('')
    if (!supabase) {
      setError(supabaseConfigurationError)
      return
    }
    if (!tipoMaterial) {
      setError('Selecciona el polímero antes de iniciar un maxisaco.')
      return
    }

    setSavingRun(true)
    let numeroVale = ''
    try {
      const { data: latest, error: latestError } = await supabase
        .from('corridas_extrusion')
        .select('id_corrida')
        .order('id_corrida', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestError) throw latestError
      const nextSequence = (Number(latest?.id_corrida) || 0) + 1
      const baseVale = formatValeSequence(nextSequence)
      let corridaCreada = null
      let duplicateError
      const baseRunData = {
        id_tipo_residuo: Number.parseInt(tipoMaterial.id_tipo_residuo, 10),
        kilos_scrap_entrada: 0,
        kilos_scrap_alimentados: 0,
        kilos_pellet_maxisaco: 0,
        estado_stock: 'EN_LLENADO',
        operario_nombre: getLoggedInUserName(user?.nombre_completo),
      }

      if (!Number.isInteger(baseRunData.id_tipo_residuo)) {
        throw new Error('El identificador del polímero seleccionado no es válido.')
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const now = new Date()
        const suffix = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${Math.random().toString(36).slice(2, 4).toUpperCase()}`
        numeroVale = attempt === 0 ? baseVale : `${baseVale}-${suffix}`
        const runData = { ...baseRunData, numero_vale: numeroVale }
        let { data, error: insertError } = await supabase
          .from('corridas_extrusion')
          .insert(runData)
          .select('*, tipos_residuo ( codigo, nombre )')
          .single()

        if (isMissingColumn(insertError, 'kilos_scrap_alimentados')) {
          const compatibleRunData = { ...runData }
          delete compatibleRunData.kilos_scrap_alimentados
          const retryResult = await supabase
            .from('corridas_extrusion')
            .insert(compatibleRunData)
            .select('*, tipos_residuo ( codigo, nombre )')
            .single()
          data = retryResult.data
          insertError = retryResult.error
        }

        if (!insertError) {
          corridaCreada = data
          break
        }
        if (insertError.code !== '23505') throw insertError
        duplicateError = insertError
      }

      if (!corridaCreada) throw duplicateError

      const { error: auditError } = await supabase
        .from('logs_auditoria')
        .insert({
          tabla_afectada: 'corridas_extrusion',
          id_registro: Number(corridaCreada.id_corrida) || 0,
          operacion: 'INSERT',
          datos_nuevos: corridaCreada,
          usuario_nombre: user.nombre_completo,
        })

      if (auditError) throw new Error(`El maxisaco se abrió, pero falló la auditoría: ${auditError.message}`)
      setNotice(`Maxisaco ${numeroVale} abierto para ${tipoMaterial.nombre}.`)
      await cargarDatos({ silent: true })
    } catch (createError) {
      setError(getErrorMessage(createError))
      await cargarDatos({ silent: true })
    } finally {
      setSavingRun(false)
    }
  }

  async function cerrarMaxisaco() {
    setError('')
    setNotice('')
    if (!maxisacoActivo) {
      setError('No hay un maxisaco activo en llenado.')
      return
    }
    if (!kilosPelletMaxisaco || Number(kilosPelletMaxisaco) <= 0) {
      setError('Ingresa los kilos netos de pellet pesados en la báscula (mayor a 0).')
      return
    }
    if (Number(maxisacoActivo.kilos_scrap_alimentados || 0) <= 0) {
      setError('Debes vaciar al menos un bin al horno antes de cerrar el maxisaco.')
      return
    }
    if (!supabase) {
      setError(supabaseConfigurationError)
      return
    }
    if (!tipoMaterial) {
      setError('No se pudo identificar el polímero del maxisaco activo.')
      return
    }

    const scrapTotal = Number(
      maxisacoActivo.kilos_scrap_alimentados || maxisacoActivo.kilos_scrap_entrada || 0,
    )
    const pelletFinal = Number(kilosPelletMaxisaco)
    const mermaKg = Number((scrapTotal - pelletFinal).toFixed(2))
    const mermaPorcentaje = scrapTotal > 0
      ? Number(((mermaKg / scrapTotal) * 100).toFixed(2))
      : 0

    if (pelletFinal > scrapTotal) {
      setError(`El peso de pellet no puede superar los ${formatKg(scrapTotal)} de scrap alimentado.`)
      return
    }
    if (mermaPorcentaje > 8 && !causalTecnica.trim()) {
      setError('La merma supera el 8%. Ingresa la causal técnica antes de cerrar.')
      return
    }

    setCerrandoMaxisaco(true)
    const closedAt = new Date()
    const updateData = {
      kilos_scrap_entrada: scrapTotal,
      kilos_scrap_alimentados: scrapTotal,
      kilos_pellet_maxisaco: pelletFinal,
      merma_kg: mermaKg,
      merma_porcentaje: mermaPorcentaje,
      porcentaje_merma: mermaPorcentaje,
      porcentaje_merma_real: mermaPorcentaje,
      color_pellet: colorPellet,
      causal_tecnica: causalTecnica.trim() || null,
      estado_stock: 'EN_BODEGA',
    }

    try {
      const { data: corridaCerrada, error: updateError } = await supabase
        .from('corridas_extrusion')
        .update(updateData)
        .eq('id_corrida', maxisacoActivo.id_corrida)
        .eq('estado_stock', 'EN_LLENADO')
        .select('*, tipos_residuo ( codigo, nombre )')
        .maybeSingle()

      if (updateError) throw updateError
      if (!corridaCerrada) throw new Error('El maxisaco ya fue cerrado o dejó de estar en llenado.')

      setUltimoValeEmitido({
        numeroVale: corridaCerrada.numero_vale,
        material: tipoMaterial.nombre,
        color: colorPellet,
        kilosNetos: pelletFinal,
        kilosScrap: scrapTotal,
        fecha: closedAt.toLocaleString('es-CL'),
        merma: mermaPorcentaje,
      })
      setKilosPelletMaxisaco('')
      setColorPellet('Negro')
      setCausalTecnica('')

      let auditMessage = ''
      try {
        const { error: auditError } = await supabase
          .from('logs_auditoria')
          .insert({
            tabla_afectada: 'corridas_extrusion',
            id_registro: Number(corridaCerrada.id_corrida) || 0,
            operacion: 'UPDATE',
            datos_nuevos: corridaCerrada,
            usuario_nombre: user.nombre_completo,
          })
        if (auditError) auditMessage = getErrorMessage(auditError)
      } catch (auditError) {
        auditMessage = getErrorMessage(auditError)
      }

      const reloaded = await cargarDatos({ silent: true })
      if (auditMessage || !reloaded) {
        const messages = []
        if (auditMessage) messages.push(`Maxisaco cerrado, pero falló la auditoría: ${auditMessage}`)
        if (!reloaded) messages.push('Maxisaco cerrado, pero no se pudo recargar el estado de la estación.')
        setError(messages.join(' '))
      } else {
        setNotice(`${corridaCerrada.numero_vale} cerrado y enviado a bodega.`)
      }
    } catch (closeError) {
      console.error('Error al cerrar el maxisaco y enviarlo a bodega:', closeError)
      const message = getErrorMessage(closeError)
      const reloaded = await cargarDatos({ silent: true })
      setError(reloaded ? message : `${message} No se pudo recargar el estado de la estación.`)
    } finally {
      setCerrandoMaxisaco(false)
    }
  }

  function handleTipoMaterialChange(event) {
    setTipoMaterialId(event.target.value)
    setKilosPelletMaxisaco('')
    setCausalTecnica('')
    setColorPellet('Negro')
    setError('')
    setNotice('')
  }

  function clearLabel() {
    setUltimoValeEmitido(null)
    setTipoMaterialId('')
    setKilosPelletMaxisaco('')
    setColorPellet('Negro')
    setCausalTecnica('')
    setError('')
    setNotice('')
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-2xl bg-rose-900 p-5 text-white shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/15 p-3" aria-hidden="true">
              <Flame className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-medium text-rose-100">GreenSpot · Línea de proceso</p>
              <h1 className="text-2xl font-bold tracking-tight">Moledora / Horno / Silo</h1>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-2 text-sm text-rose-100">
            <Scale className="h-4 w-4" aria-hidden="true" />
            Alimentación continua y liberación inmediata de bins
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
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <p>{notice}</p>
          </div>
        )}

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
                <dt className="text-xs font-bold uppercase text-slate-600">Polímero</dt>
                <dd className="mt-1 text-lg font-black">{ultimoValeEmitido.material}</dd>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="text-xs font-bold uppercase text-slate-600">Color</dt>
                <dd className="mt-1 text-lg font-black">{ultimoValeEmitido.color}</dd>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="text-xs font-bold uppercase text-slate-600">Kilos de pellet</dt>
                <dd className="mt-1 text-lg font-black">{formatKg(ultimoValeEmitido.kilosNetos)}</dd>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="text-xs font-bold uppercase text-slate-600">Kilos alimentados</dt>
                <dd className="mt-1 text-lg font-black">{formatKg(ultimoValeEmitido.kilosScrap)}</dd>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="text-xs font-bold uppercase text-slate-600">Fecha</dt>
                <dd className="mt-1 text-sm font-bold">{ultimoValeEmitido.fecha}</dd>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="text-xs font-bold uppercase text-slate-600">Merma real</dt>
                <dd className="mt-1 text-lg font-black">{numberFormat.format(ultimoValeEmitido.merma)}%</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={clearLabel}
              className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-base font-bold text-white hover:bg-slate-800"
            >
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              Cerrar Vale / Nueva Corrida
            </button>
          </section>
        )}

        {loading ? (
          <section className="flex items-center gap-3 rounded-2xl bg-white p-6 text-slate-600 shadow-sm" role="status">
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            Cargando silos abiertos y bins en espera...
          </section>
        ) : (
          <>
            <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm sm:p-6">
              <div>
                <h2 className="text-lg font-bold">Bloque 1 — Alimentación a Tolva (Extrusora / Horno)</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Selecciona el polímero para continuar un maxisaco abierto o iniciar uno nuevo.
                </p>
              </div>

              <div>
                <label htmlFor="tipo_material_corrida" className="mb-2 block text-sm font-semibold">
                  Tipo de Polímero
                </label>
                <select
                  id="tipo_material_corrida"
                  name="tipo_material_corrida"
                  required
                  value={tipoMaterialId}
                  onChange={handleTipoMaterialChange}
                  disabled={savingRun || Boolean(procesandoBinId)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-rose-800 focus:ring-2 focus:ring-rose-800/20"
                >
                  <option value="">Selecciona un polímero</option>
                  {tiposResiduo.map((tipo) => (
                    <option key={tipo.id_tipo_residuo} value={tipo.id_tipo_residuo}>
                      {tipo.codigo} · {tipo.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {!tipoMaterialId ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  Selecciona un polímero para consultar su maxisaco y bins disponibles.
                </p>
              ) : !siloActivo ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="font-bold text-amber-950">
                    No hay maxisaco en llenado para {tipoMaterial?.nombre}.
                  </p>
                  <p className="mt-1 text-sm text-amber-900">
                    Inicia un maxisaco para poder vaciar bins de este mismo polímero.
                  </p>
                  <button
                    type="button"
                    onClick={iniciarMaxisaco}
                    disabled={savingRun || !supabase}
                    className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-rose-900 px-5 text-base font-black text-white hover:bg-rose-950 disabled:bg-slate-400 sm:w-auto sm:min-w-64"
                  >
                    {savingRun
                      ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                      : <PackageCheck className="h-5 w-5" aria-hidden="true" />}
                    Iniciar Maxisaco en Silo
                  </button>
                </div>
              ) : (
                <>
                  <article className="rounded-2xl border-2 border-rose-900 bg-rose-950 p-5 text-white shadow-sm sm:p-6">
                    <p className="text-sm font-bold uppercase tracking-wide text-rose-200">Lote en Línea / Maxisaco en curso</p>
                    <p className="mt-2 text-3xl font-black">{siloActivo.numero_vale}</p>
                    <p className="mt-1 text-lg font-bold">{tipoMaterial?.nombre}</p>
                    <div className="mt-5 rounded-xl bg-white/10 p-4">
                      <p className="text-sm font-semibold text-rose-100">Kilos acumulados vaciados hasta ahora</p>
                      <p className="mt-1 text-3xl font-black">{formatKg(kilosAlimentados)}</p>
                    </div>
                    <div className="mt-4">
                      <p className="font-bold">Bins volcados en este lote</p>
                      {binsVolcados.length === 0 ? (
                        <p className="mt-2 text-sm text-rose-100">Aún no se han vaciado bins en este maxisaco.</p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {binsVolcados.map((pesaje) => (
                            <li
                              key={pesaje.id_pesaje}
                              className="flex items-center justify-between gap-3 rounded-lg bg-white/10 px-3 py-2 text-sm"
                            >
                              <span className="font-bold">{pesaje.bins_maestro?.codigo_qr || `Bin ${pesaje.id_bin}`}</span>
                              <span>{formatKg(getNetWeight(pesaje))}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </article>

                  <section className="space-y-4 rounded-xl border border-slate-200 p-4">
                    <div>
                      <h3 className="text-lg font-bold">Bins molidos listos para volcar a la extrusora</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Solo se muestran bins en espera del polímero {tipoMaterial?.nombre}. Cada vaciado libera el bin al instante.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setScanning((current) => !current)}
                      disabled={Boolean(procesandoBinId) || !supabase || !binsLoadedForActiveRun}
                      className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-rose-900 px-5 text-base font-bold text-rose-950 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <QrCode className="h-5 w-5" aria-hidden="true" />
                      {scanning ? 'Cerrar Escáner' : 'Escanear QR del Bin'}
                    </button>

                    {scanning && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
                        <section
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="extrusion-scanner-title"
                          className="w-full max-w-md space-y-4 rounded-2xl bg-white p-4 shadow-xl"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <h3 id="extrusion-scanner-title" className="font-bold">Escanear QR del Bin</h3>
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
                            id="extrusion-qr-reader"
                            className="overflow-hidden rounded-xl border border-slate-200"
                            aria-label="Cámara trasera para escanear bins del horno"
                          />
                          <p className="text-sm text-slate-600">Apunta la cámara trasera al código del bin.</p>
                        </section>
                      </div>
                    )}

                    {binsCompatibles.length === 0 ? (
                      <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                        No hay bins en espera para {tipoMaterial?.nombre}.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {binsCompatibles.map((pesaje) => (
                          <li
                            key={pesaje.id_pesaje}
                            className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <p className="font-bold">{pesaje.bins_maestro?.codigo_qr || `Bin ${pesaje.id_bin}`}</p>
                              <p className="mt-1 text-sm text-slate-600">
                                {pesaje.tipos_residuo?.codigo} · {pesaje.tipos_residuo?.nombre}
                              </p>
                              <p className="mt-1 text-lg font-black text-rose-900">
                                {formatKg(getNetWeight(pesaje))} netos
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleVaciarBin(pesaje)}
                              disabled={Boolean(procesandoBinId) || savingRun || !binsLoadedForActiveRun}
                              className="flex min-h-14 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-rose-900 px-4 text-sm font-black text-white hover:bg-rose-950 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto"
                            >
                              {procesandoBinId === String(pesaje.id_pesaje)
                                ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                                : <Flame className="h-5 w-5" aria-hidden="true" />}
                              {procesandoBinId === String(pesaje.id_pesaje) ? 'Vaciando...' : 'Vaciar a Línea y Liberar Bin'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                    <div>
                      <h3 className="text-lg font-bold">Bloque 3 — Descarga de Silo y Cierre de Maxisaco</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Total alimentado a la extrusora: <strong>{formatKg(kilosAlimentados)}</strong>. Registra los kilos netos de pellet descargados desde el silo.
                      </p>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="kilos_pellet_maxisaco" className="mb-2 block text-sm font-semibold">
                          Kilos Netos de Pellet en Maxisaco
                        </label>
                        <input
                          id="kilos_pellet_maxisaco"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={kilosAlimentados}
                          step="any"
                          value={kilosPelletMaxisaco}
                          onChange={(event) => setKilosPelletMaxisaco(event.target.value)}
                          placeholder="0"
                          disabled={savingRun || Boolean(procesandoBinId) || kilosAlimentados <= 0}
                          className="min-h-14 w-full rounded-xl border border-slate-300 px-4 text-2xl font-bold outline-none focus:border-rose-800 focus:ring-2 focus:ring-rose-800/20 disabled:bg-slate-100"
                        />
                      </div>

                      <div>
                        <label htmlFor="color_pellet" className="mb-2 block text-sm font-semibold">
                          Color del pellet
                        </label>
                        <select
                          id="color_pellet"
                          value={colorPellet}
                          onChange={(event) => setColorPellet(event.target.value)}
                          disabled={savingRun || Boolean(procesandoBinId)}
                          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-rose-800 focus:ring-2 focus:ring-rose-800/20"
                        >
                          {colors.map((color) => <option key={color} value={color}>{color}</option>)}
                        </select>
                      </div>

                      {kilosPelletMaxisaco !== '' && !pesoPelletValido && (
                        <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                          El peso de pellet debe ser mayor que cero y no superar los {formatKg(kilosAlimentados)} alimentados.
                        </p>
                      )}

                      {mermaReal !== null && (
                        <div className={`rounded-xl p-4 ${
                          mermaRequiereCausal ? 'border-2 border-red-500 bg-red-50 text-red-900' : 'bg-emerald-50 text-emerald-900'
                        }`}>
                          <p className="text-sm font-semibold">Merma real calculada</p>
                          <p className="mt-1 text-3xl font-black">{numberFormat.format(mermaReal)}%</p>
                          {mermaRequiereCausal && (
                            <div className="mt-3 space-y-2">
                              <p className="font-bold">La merma supera el 8%. Registra la causal técnica.</p>
                              <label htmlFor="causal_tecnica" className="block text-sm font-bold">
                                Causal técnica
                                <textarea
                                  id="causal_tecnica"
                                  rows="3"
                                  value={causalTecnica}
                                  onChange={(event) => setCausalTecnica(event.target.value)}
                                  className="mt-2 w-full rounded-xl border border-red-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-700/20"
                                  placeholder="Describe la causa de la merma..."
                                />
                              </label>
                            </div>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={cerrarMaxisaco}
                        disabled={savingRun || cerrandoMaxisaco || Boolean(procesandoBinId) || !supabase}
                        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 text-base font-black text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        {cerrandoMaxisaco
                          ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                          : <Truck className="h-5 w-5" aria-hidden="true" />}
                        {cerrandoMaxisaco ? 'Cerrando y generando vale...' : 'Cerrar Maxisaco y Enviar a Bodega'}
                      </button>
                    </div>
                  </section>
                </>
              )}
            </section>

            <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Últimas corridas de extrusión</h2>
                  <p className="mt-1 text-sm text-slate-600">Historial de maxisacos en llenado o enviados a bodega.</p>
                </div>
                <button
                  type="button"
                  onClick={() => cargarDatos()}
                  disabled={loading}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-bold hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  Actualizar
                </button>
              </div>
              {corridasRecientes.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Aún no hay corridas registradas.</p>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {corridasRecientes.map((corrida) => {
                    const tipo = getRelatedType(corrida)
                    const material = tipo?.nombre
                      ?? tiposResiduo.find(
                        (item) => String(item.id_tipo_residuo) === String(corrida.id_tipo_residuo),
                      )?.nombre
                      ?? 'Material no identificado'
                    const kilosLote = Number(corrida.kilos_scrap_alimentados)
                      || Number(corrida.kilos_scrap_entrada)
                      || 0

                    return (
                      <li key={corrida.id_corrida} className="grid gap-2 py-4 sm:grid-cols-2">
                        <div>
                          <p className="font-bold">{corrida.numero_vale || `Corrida ${corrida.id_corrida}`}</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-900">Tipo de Polímero: {material}</p>
                          <p className="mt-1 text-xs font-bold uppercase text-slate-500">{corrida.estado_stock || 'Sin estado'}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm sm:text-right">
                          <p>Scrap alimentado: <strong>{formatKg(kilosLote)}</strong></p>
                          {corrida.kilos_pellet_maxisaco !== null && corrida.kilos_pellet_maxisaco !== undefined && (
                            <p>Maxisaco: <strong>{formatKg(corrida.kilos_pellet_maxisaco)}</strong></p>
                          )}
                          {corrida.color_pellet && <p>Color: <strong>{corrida.color_pellet}</strong></p>}
                          {corrida.porcentaje_merma_real !== null && corrida.porcentaje_merma_real !== undefined && (
                            <p>Merma real: <strong>{numberFormat.format(Number(corrida.porcentaje_merma_real) || 0)}%</strong></p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
