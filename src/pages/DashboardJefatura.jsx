import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Boxes,
  CheckCircle2,
  Download,
  FileClock,
  Flame,
  LoaderCircle,
  PackageCheck,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Users,
  Weight,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase, supabaseConfigurationError } from '../lib/supabaseClient'

const pageSize = 500
const tableDefinitions = [
  { id: 'recepciones_guia', label: 'Recepciones', sheet: 'Recepciones' },
  { id: 'pesajes_scrap', label: 'Pesajes Scrap', sheet: 'Pesajes Scrap' },
  {
    id: 'corridas_extrusion',
    label: 'Corridas Extrusión',
    sheet: 'Corridas Extrusion',
    select: '*, tipos_residuo ( codigo, nombre )',
  },
  { id: 'pallets_eps', label: 'Pallets EPS', sheet: 'Pallets EPS' },
  { id: 'despachos_salida', label: 'Despachos', sheet: 'Despachos' },
  { id: 'logs_auditoria', label: 'Auditoría', sheet: 'Auditoria' },
]
const realtimeTables = [
  ...tableDefinitions.map(({ id }) => id),
  'bins_maestro',
  'usuarios_planta',
  'tipos_residuo',
]
const dashboardSections = [
  { id: 'resumen', label: 'Resumen', Icon: Weight },
  { id: 'despachos', label: 'Despachos / Salida', Icon: Truck },
  { id: 'maestros', label: 'Maestros (Bins y Usuarios)', Icon: Users },
  { id: 'historial', label: 'Historial', Icon: FileClock },
]

function sumField(rows, field) {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0)
}

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits }).format(value)
}

function displayCell(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function getRelatedType(row) {
  return Array.isArray(row?.tipos_residuo) ? row.tipos_residuo[0] : row?.tipos_residuo
}

function getNetWeight(row) {
  if (
    row.peso_neto_kg !== null
    && row.peso_neto_kg !== undefined
    && Number.isFinite(Number(row.peso_neto_kg))
  ) {
    return Number(row.peso_neto_kg)
  }
  return Math.max(0, (Number(row.peso_bruto_kg) || 0) - (Number(row.tara_aplicada_kg) || 0))
}

function getRecordId(row, preferredKeys = []) {
  for (const key of preferredKeys) {
    if (Number.isFinite(Number(row?.[key]))) return Number(row[key])
  }
  const primaryKey = Object.keys(row ?? {}).find((key) => (
    key.startsWith('id_') && Number.isFinite(Number(row[key]))
  ))
  return primaryKey ? Number(row[primaryKey]) : 0
}

function KpiCard({ label, value, detail, Icon, tone }) {
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-600">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <span className={`rounded-xl p-3 ${tone}`} aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </article>
  )
}

function SectionButton({ active, id, label, Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      aria-pressed={active}
      className={`flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold ${
        active ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  )
}

export default function DashboardJefatura({ user }) {
  const [historiales, setHistoriales] = useState({})
  const [bins, setBins] = useState([])
  const [binsToPrint, setBinsToPrint] = useState(null)
  const [usuarios, setUsuarios] = useState([])
  const [tiposResiduo, setTiposResiduo] = useState([])
  const [activeSection, setActiveSection] = useState('resumen')
  const [activeTable, setActiveTable] = useState(tableDefinitions[0].id)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [savingDispatch, setSavingDispatch] = useState(false)
  const [dispatchGuide, setDispatchGuide] = useState('')
  const [dispatchClient, setDispatchClient] = useState('')
  const [selectedItems, setSelectedItems] = useState([])
  const [savingBin, setSavingBin] = useState(false)
  const [binCode, setBinCode] = useState('')
  const [binTare, setBinTare] = useState('')
  const [savingUser, setSavingUser] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [newRole, setNewRole] = useState('OPERARIO')
  const [updatingUserId, setUpdatingUserId] = useState(null)

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (!supabase) {
      setError(supabaseConfigurationError)
      setLoading(false)
      return
    }

    if (!silent) setLoading(true)
    setError('')

    async function fetchAll(table, columns = '*') {
      const allRows = []
      let offset = 0
      let totalCount = null

      while (totalCount === null || offset < totalCount) {
        const { data, error: queryError, count } = await supabase
          .from(table)
          .select(columns, { count: 'exact' })
          .range(offset, offset + pageSize - 1)

        if (queryError) throw new Error(`No se pudo consultar ${table}: ${queryError.message}`)
        const rows = data ?? []
        if (totalCount === null) totalCount = count ?? rows.length
        allRows.push(...rows)
        offset += rows.length
        if (rows.length === 0) break
      }

      return allRows
    }

    try {
      const [historyResults, binsResult, usersResult, typesResult] = await Promise.all([
        Promise.all(tableDefinitions.map(async ({ id, select }) => [id, await fetchAll(id, select)])),
        fetchAll('bins_maestro', 'id_bin, codigo_qr, tara_kg, estado'),
        fetchAll('usuarios_planta', 'id_usuario, usuario, nombre_completo, rol, activo'),
        fetchAll('tipos_residuo', 'id_tipo_residuo, codigo, nombre, peso_teorico_unidad_kg'),
      ])

      const histories = Object.fromEntries(historyResults)
      const typeById = new Map(typesResult.map((tipo) => [String(tipo.id_tipo_residuo), tipo]))
      const corridasWithType = (histories.corridas_extrusion ?? []).map((row) => {
        const { tipos_residuo: joinedType, ...corrida } = row
        const tipo = getRelatedType({ tipos_residuo: joinedType })
          || typeById.get(String(row.id_tipo_residuo))
        return {
          ...corrida,
          tipo_polimero: tipo?.nombre || tipo?.codigo || 'Polímero no identificado',
        }
      })
      const polymerByRunId = new Map(
        corridasWithType.map((corrida) => [String(corrida.id_corrida), corrida.tipo_polimero]),
      )
      histories.corridas_extrusion = corridasWithType
      const epsName = typesResult.find((tipo) => tipo.codigo === 'EPS-BLOQ')?.nombre || 'EPS-BLOQ'
      histories.despachos_salida = (histories.despachos_salida ?? []).map((row) => ({
        ...row,
        tipo_polimero: row.tipo_producto === 'PELLET'
          ? polymerByRunId.get(String(row.id_referencia)) || 'Polímero no identificado'
          : row.tipo_producto === 'PLUMAVIT_EPS'
            ? epsName
            : 'No aplica',
      }))
      setHistoriales(histories)
      setBins(binsResult)
      setUsuarios(usersResult)
      setTiposResiduo(typesResult)
      setLastUpdated(new Date())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los datos de Jefatura.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    let refreshTimer
    const initialLoadTimer = window.setTimeout(() => {
      if (active) loadDashboard()
    }, 0)
    const channel = supabase
      ? realtimeTables.reduce(
        (currentChannel, table) => currentChannel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          () => {
            window.clearTimeout(refreshTimer)
            refreshTimer = window.setTimeout(() => {
              if (active) loadDashboard({ silent: true })
            }, 400)
          },
        ),
        supabase.channel('greenspot-dashboard-jefatura'),
      ).subscribe()
      : null

    return () => {
      active = false
      window.clearTimeout(initialLoadTimer)
      window.clearTimeout(refreshTimer)
      if (channel) supabase.removeChannel(channel)
    }
  }, [loadDashboard])

  useEffect(() => {
    if (!binsToPrint) return undefined

    const handleAfterPrint = () => setBinsToPrint(null)
    window.addEventListener('afterprint', handleAfterPrint)
    const printTimer = window.setTimeout(() => window.print(), 100)

    return () => {
      window.clearTimeout(printTimer)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [binsToPrint])

  const recepciones = historiales.recepciones_guia ?? []
  const pesajes = historiales.pesajes_scrap ?? []
  const corridas = historiales.corridas_extrusion ?? []
  const pallets = historiales.pallets_eps ?? []
  const despachos = historiales.despachos_salida ?? []
  const kilosAceptados = sumField(recepciones, 'kilos_teoricos_aceptados')
  const kilosRechazados = sumField(recepciones, 'kilos_teoricos_rechazados')
  const typeNames = new Map(tiposResiduo.map((tipo) => [String(tipo.id_tipo_residuo), tipo.nombre]))
  const acopioPatioPorTipo = recepciones.reduce((totals, row) => {
    const name = typeNames.get(String(row.id_tipo_residuo)) || `Tipo ${row.id_tipo_residuo ?? 'sin asignar'}`
    totals.set(name, (totals.get(name) || 0) + (Number(row.kilos_teoricos_aceptados) || 0))
    return totals
  }, new Map())
  const pesajesEnEspera = pesajes.filter((row) => row.estado_consumo === 'EN_ESPERA_HORNO')
  const kilosEnEspera = pesajesEnEspera.reduce((total, row) => total + getNetWeight(row), 0)
  const kilosPellet = sumField(corridas, 'kilos_pellet_maxisaco')
  const corridasConMerma = corridas.filter((row) => Number.isFinite(Number(row.porcentaje_merma)))
  const mermaPromedio = corridasConMerma.length
    ? sumField(corridasConMerma, 'porcentaje_merma') / corridasConMerma.length
    : 0
  const palletsListos = pallets.filter((row) => ['COMPLETO', 'BODEGA_EXTERIOR'].includes(row.estado))
  const bloquesListos = sumField(palletsListos, 'bloques_actuales')
  const pelletEnBodega = corridas.filter((row) => row.estado_stock === 'EN_BODEGA')
  const scrapPorTipo = pesajesEnEspera.reduce((totals, row) => {
    const name = typeNames.get(String(row.id_tipo_residuo)) || `Tipo ${row.id_tipo_residuo ?? 'sin asignar'}`
    totals.set(name, (totals.get(name) || 0) + getNetWeight(row))
    return totals
  }, new Map())
  const maxisacosPorTipo = pelletEnBodega.reduce((totals, row) => {
    const name = row.tipo_polimero || 'Polímero no identificado'
    const current = totals.get(name) || { cantidad: 0, kilos: 0 }
    current.cantidad += 1
    current.kilos += Number(row.kilos_pellet_maxisaco) || 0
    totals.set(name, current)
    return totals
  }, new Map())
  const epsType = tiposResiduo.find((tipo) => tipo.codigo === 'EPS-BLOQ')
  const epsBlockWeight = epsType ? Number(epsType.peso_teorico_unidad_kg) : 18
  const epsWeightAvailable = Number.isFinite(epsBlockWeight) && epsBlockWeight > 0

  const dispatchItems = [
    ...pelletEnBodega.map((row) => ({
      key: `PELLET:${row.id_corrida}`,
      tipoProducto: 'PELLET',
      idReferencia: row.id_corrida,
      codigoReferencia: row.numero_vale || `Corrida ${row.id_corrida}`,
      tipoPolimero: row.tipo_polimero || 'Polímero no identificado',
      kilos: Number(row.kilos_pellet_maxisaco) || 0,
      detail: `${row.color_pellet || 'Color sin indicar'} · ${formatNumber(Number(row.kilos_pellet_maxisaco) || 0, 1)} kg`,
      available: true,
    })),
    ...palletsListos.map((row) => ({
      key: `PLUMAVIT_EPS:${row.id_pallet}`,
      tipoProducto: 'PLUMAVIT_EPS',
      idReferencia: row.id_pallet,
      codigoReferencia: row.codigo_pallet || `Pallet ${row.id_pallet}`,
      tipoPolimero: epsType?.nombre || 'EPS-BLOQ',
      kilos: (Number(row.bloques_actuales) || 0) * (epsWeightAvailable ? epsBlockWeight : 0),
      detail: `${row.bloques_actuales} bloques · ${epsWeightAvailable
        ? `${formatNumber((Number(row.bloques_actuales) || 0) * epsBlockWeight, 1)} kg`
        : 'Peso EPS no válido'}`,
      available: epsWeightAvailable,
    })),
  ]

  const selectedRows = historiales[activeTable] ?? []
  const normalizedSearch = search.trim().toLocaleLowerCase('es-CL')
  const filteredRows = normalizedSearch
    ? selectedRows.filter((row) => (
      JSON.stringify(row).toLocaleLowerCase('es-CL').includes(normalizedSearch)
    ))
    : selectedRows
  const columns = selectedRows.length > 0 ? Object.keys(selectedRows[0]) : []
  const activeLabel = tableDefinitions.find((table) => table.id === activeTable)?.label ?? ''

  async function writeAudit({ table, operation, id, data }) {
    const { error: auditError } = await supabase
      .from('logs_auditoria')
      .insert({
        tabla_afectada: table,
        operacion: operation,
        id_registro: Number(id) || 0,
        datos_nuevos: data,
        usuario_nombre: user?.nombre_completo || 'Jefatura',
      })

    if (auditError) throw new Error(`El registro se guardó, pero falló la auditoría: ${auditError.message}`)
  }

  async function exportHistory() {
    setExporting(true)
    setError('')

    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.utils.book_new()
      tableDefinitions.forEach(({ id, sheet }) => {
        const rows = (historiales[id] ?? []).map((row) => {
          if (id !== 'corridas_extrusion' && id !== 'despachos_salida') return row
          const exportRow = { ...row }
          const typeName = exportRow.tipo_polimero
          delete exportRow.tipos_residuo
          delete exportRow.tipo_polimero
          return { ...exportRow, 'Tipo de Polímero': typeName }
        })
        const worksheet = rows.length
          ? XLSX.utils.json_to_sheet(rows)
          : XLSX.utils.aoa_to_sheet([['Sin registros']])
        XLSX.utils.book_append_sheet(workbook, worksheet, sheet)
      })
      XLSX.writeFile(workbook, `greenspot-jefatura-${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'No se pudo generar el archivo Excel.')
    } finally {
      setExporting(false)
    }
  }

  function toggleDispatchItem(key) {
    setSelectedItems((current) => (
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    ))
  }

  async function handleDispatch(event) {
    event.preventDefault()
    setActionError('')
    setNotice('')
    if (!supabase) {
      setActionError(supabaseConfigurationError)
      return
    }
    const itemsToDispatch = dispatchItems.filter((item) => selectedItems.includes(item.key))
    if (!dispatchGuide.trim() || !dispatchClient.trim() || itemsToDispatch.length === 0) {
      setActionError('Ingresa la guía, el cliente/destino y selecciona al menos un producto.')
      return
    }

    setSavingDispatch(true)
    const completedItems = []
    try {
      for (const item of itemsToDispatch) {
        const dispatchRecord = {
          numero_guia_salida: dispatchGuide.trim().toUpperCase(),
          cliente_destino: dispatchClient.trim(),
          tipo_producto: item.tipoProducto,
          id_referencia: Number(item.idReferencia),
          codigo_referencia: item.codigoReferencia,
          kilos_despachados: item.kilos,
          usuario_nombre: user?.nombre_completo || 'Jefatura',
        }
        const { data: createdDispatch, error: insertError } = await supabase
          .from('despachos_salida')
          .insert(dispatchRecord)
          .select()
          .single()

        if (insertError) throw new Error(`No se pudo registrar ${item.codigoReferencia}: ${insertError.message}`)

        const targetTable = item.tipoProducto === 'PELLET' ? 'corridas_extrusion' : 'pallets_eps'
        const targetId = item.tipoProducto === 'PELLET' ? 'id_corrida' : 'id_pallet'
        const statusUpdate = item.tipoProducto === 'PELLET'
          ? { estado_stock: 'DESPACHADO' }
          : { estado: 'DESPACHADO' }
        const { error: updateError } = await supabase
          .from(targetTable)
          .update(statusUpdate)
          .eq(targetId, item.idReferencia)

        if (updateError) {
          throw new Error(
            `${item.codigoReferencia} quedó registrado en despachos, pero no se pudo actualizar su estado: ${updateError.message}`,
          )
        }

        await writeAudit({
          table: 'despachos_salida',
          operation: 'INSERT',
          id: getRecordId(createdDispatch, ['id_despacho']),
          data: { ...dispatchRecord, estado_actualizado_en: targetTable, referencia_id: item.idReferencia },
        })
        completedItems.push(item.codigoReferencia)
      }

      setNotice(`Despacho ${dispatchGuide.trim().toUpperCase()} registrado para ${completedItems.length} producto(s).`)
      setDispatchGuide('')
      setDispatchClient('')
      setSelectedItems([])
      await loadDashboard({ silent: true })
    } catch (dispatchError) {
      const progress = completedItems.length
        ? ` Se completaron ${completedItems.length} producto(s): ${completedItems.join(', ')}.`
        : ''
      setActionError(`${dispatchError instanceof Error ? dispatchError.message : 'No se pudo completar el despacho.'}${progress}`)
      await loadDashboard({ silent: true })
    } finally {
      setSavingDispatch(false)
    }
  }

  async function handleCreateBin(event) {
    event.preventDefault()
    setActionError('')
    setNotice('')
    if (!supabase) {
      setActionError(supabaseConfigurationError)
      return
    }
    const normalizedCode = binCode.trim().toUpperCase()
    const tare = Number(binTare)
    if (!normalizedCode || !Number.isFinite(tare) || tare <= 0) {
      setActionError('Ingresa un código QR y una tara mayor que cero.')
      return
    }

    setSavingBin(true)
    try {
      const newBin = { codigo_qr: normalizedCode, tara_kg: tare, estado: 'DISPONIBLE' }
      const { data, error: insertError } = await supabase
        .from('bins_maestro')
        .insert(newBin)
        .select('id_bin, codigo_qr, tara_kg, estado')
        .single()
      if (insertError) throw insertError
      await writeAudit({
        table: 'bins_maestro',
        operation: 'INSERT',
        id: data.id_bin,
        data,
      })
      setBins((current) => [...current, data].sort((a, b) => Number(a.id_bin) - Number(b.id_bin)))
      setBinCode('')
      setBinTare('')
      setNotice(`${data.codigo_qr} creado y disponible.`)
    } catch (createError) {
      setActionError(createError.message || 'No se pudo crear el bin.')
      await loadDashboard({ silent: true })
    } finally {
      setSavingBin(false)
    }
  }

  function printBinLabels(binsToPrintNow) {
    if (binsToPrintNow.length === 0) return
    setBinsToPrint(binsToPrintNow)
  }

  async function handleCreateUser(event) {
    event.preventDefault()
    setActionError('')
    setNotice('')
    if (!supabase) {
      setActionError(supabaseConfigurationError)
      return
    }
    if (!newUsername.trim() || !newPassword || !newFullName.trim()) {
      setActionError('Completa usuario, contraseña y nombre completo.')
      return
    }

    setSavingUser(true)
    try {
      const userRecord = {
        usuario: newUsername.trim(),
        clave: newPassword,
        nombre_completo: newFullName.trim(),
        rol: newRole,
        activo: true,
      }
      const { data, error: insertError } = await supabase
        .from('usuarios_planta')
        .insert(userRecord)
        .select('id_usuario, usuario, nombre_completo, rol, activo')
        .single()
      if (insertError) throw insertError
      await writeAudit({
        table: 'usuarios_planta',
        operation: 'INSERT',
        id: data.id_usuario,
        data,
      })
      setUsuarios((current) => [...current, data].sort((a, b) => Number(a.id_usuario) - Number(b.id_usuario)))
      setNewUsername('')
      setNewPassword('')
      setNewFullName('')
      setNewRole('OPERARIO')
      setNotice(`Cuenta de ${data.nombre_completo} creada.`)
    } catch (createError) {
      setActionError(createError.message || 'No se pudo crear la cuenta.')
      await loadDashboard({ silent: true })
    } finally {
      setSavingUser(false)
    }
  }

  async function toggleUserActive(targetUser) {
    setActionError('')
    setNotice('')
    if (!supabase) {
      setActionError(supabaseConfigurationError)
      return
    }

    setUpdatingUserId(targetUser.id_usuario)
    const updatedValues = { activo: !targetUser.activo }
    try {
      const { data, error: updateError } = await supabase
        .from('usuarios_planta')
        .update(updatedValues)
        .eq('id_usuario', targetUser.id_usuario)
        .select('id_usuario, usuario, nombre_completo, rol, activo')
        .single()
      if (updateError) throw updateError
      await writeAudit({
        table: 'usuarios_planta',
        operation: 'UPDATE',
        id: data.id_usuario,
        data,
      })
      setUsuarios((current) => current.map((item) => (
        String(item.id_usuario) === String(data.id_usuario) ? data : item
      )))
      setNotice(`${data.nombre_completo}: cuenta ${data.activo ? 'activada' : 'desactivada'}.`)
    } catch (updateError) {
      setActionError(`No se pudo actualizar la cuenta: ${updateError.message || 'error inesperado'}`)
      await loadDashboard({ silent: true })
    } finally {
      setUpdatingUserId(null)
    }
  }

  const selectedItemsCount = dispatchItems.filter((item) => selectedItems.includes(item.key)).length

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-emerald-800">Jefatura · GreenSpot Planta</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Panel de Jefatura</h1>
            <p className="mt-2 text-sm text-slate-600">
              Inventario, despachos y administración
              {lastUpdated && ` · Actualizado ${lastUpdated.toLocaleTimeString('es-CL')}`}
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => loadDashboard()}
              disabled={loading}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60 sm:flex-none"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Actualizar
            </button>
            <button
              type="button"
              onClick={exportHistory}
              disabled={exporting || loading || !supabase}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 text-sm font-bold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-400 sm:flex-none"
            >
              {exporting
                ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Download className="h-4 w-4" aria-hidden="true" />}
              Exportar Excel
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}
        {actionError && (
          <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>{actionError}</p>
          </div>
        )}
        {notice && (
          <div role="status" className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <p>{notice}</p>
          </div>
        )}

        <nav aria-label="Secciones de Jefatura" className="flex gap-2 overflow-x-auto pb-1">
          {dashboardSections.map(({ id, label, Icon }) => (
            <SectionButton
              key={id}
              id={id}
              label={label}
              Icon={Icon}
              active={activeSection === id}
              onClick={setActiveSection}
            />
          ))}
        </nav>

        {loading ? (
          <section className="flex items-center gap-3 rounded-2xl bg-white p-8 text-slate-600 shadow-sm" role="status">
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            Cargando inventario e historial...
          </section>
        ) : (
          <>
            {activeSection === 'resumen' && (
              <div className="space-y-6">
                <section aria-label="Indicadores clave" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <KpiCard
                    label="Kilos aceptados en patio"
                    value={`${formatNumber(kilosAceptados, 1)} kg`}
                    detail="Peso teórico aceptado"
                    Icon={Truck}
                    tone="bg-emerald-100 text-emerald-900"
                  />
                  <KpiCard
                    label="Kilos rechazados en patio"
                    value={`${formatNumber(kilosRechazados, 1)} kg`}
                    detail="Peso teórico rechazado"
                    Icon={Archive}
                    tone="bg-amber-100 text-amber-900"
                  />
                  <KpiCard
                    label="Bins en espera en Molino"
                    value={`${pesajesEnEspera.length} bins`}
                    detail={`${formatNumber(kilosEnEspera, 1)} kg netos en espera de horno`}
                    Icon={Weight}
                    tone="bg-orange-100 text-orange-900"
                  />
                  <KpiCard
                    label="Pellet producido"
                    value={`${formatNumber(kilosPellet, 1)} kg`}
                    detail="Total registrado en maxisacos"
                    Icon={Flame}
                    tone="bg-rose-100 text-rose-900"
                  />
                  <KpiCard
                    label="Merma promedio"
                    value={`${formatNumber(mermaPromedio, 2)}%`}
                    detail="Promedio de corridas"
                    Icon={FileClock}
                    tone="bg-blue-100 text-blue-900"
                  />
                  <KpiCard
                    label="Pallets EPS listos"
                    value={formatNumber(palletsListos.length)}
                    detail={`${formatNumber(bloquesListos)} bloques listos para despacho`}
                    Icon={PackageCheck}
                    tone="bg-indigo-100 text-indigo-900"
                  />
                </section>

                <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-950 p-5 text-white shadow-sm sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="rounded-xl bg-white/10 p-3" aria-hidden="true">
                      <Boxes className="h-6 w-6" />
                    </span>
                    <div>
                      <p className="text-sm font-bold uppercase tracking-wide text-emerald-200">Inventario vivo</p>
                      <h2 className="text-xl font-black">Stock actual en planta</h2>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-xl bg-white/10 p-4">
                      <p className="font-bold">Acopio teórico en patio</p>
                      <p className="mt-2 text-2xl font-black">{formatNumber(kilosAceptados, 1)} kg</p>
                      <div className="mt-3 space-y-1 text-sm text-emerald-100">
                        {acopioPatioPorTipo.size
                          ? [...acopioPatioPorTipo.entries()].map(([name, kg]) => (
                            <p key={name} className="flex justify-between gap-3">
                              <span>{name}</span><span className="font-bold">{formatNumber(kg, 1)} kg</span>
                            </p>
                          ))
                          : <p>Sin recepciones registradas.</p>}
                      </div>
                    </article>
                    <article className="rounded-xl bg-white/10 p-4">
                      <p className="font-bold">Stock en Bins · Molino → Horno</p>
                      <p className="mt-2 text-2xl font-black">{formatNumber(kilosEnEspera, 1)} kg</p>
                      <div className="mt-3 space-y-1 text-sm text-emerald-100">
                        {scrapPorTipo.size
                          ? [...scrapPorTipo.entries()].map(([name, kg]) => (
                            <p key={name} className="flex justify-between gap-3">
                              <span>{name}</span><span className="font-bold">{formatNumber(kg, 1)} kg</span>
                            </p>
                          ))
                          : <p>Sin bins esperando horno.</p>}
                      </div>
                    </article>
                    <article className="rounded-xl bg-white/10 p-4">
                      <p className="font-bold">Maxisacos en bodega por polímero</p>
                      <p className="mt-2 text-2xl font-black">
                        {formatNumber(pelletEnBodega.length)} · {formatNumber(sumField(pelletEnBodega, 'kilos_pellet_maxisaco'), 1)} kg
                      </p>
                      <div className="mt-3 space-y-1 text-sm text-emerald-100">
                        {maxisacosPorTipo.size
                          ? [...maxisacosPorTipo.entries()].map(([name, stock]) => (
                            <p key={name} className="flex justify-between gap-3">
                              <span>{name} · {formatNumber(stock.cantidad)} maxisacos</span>
                              <span className="font-bold">{formatNumber(stock.kilos, 1)} kg</span>
                            </p>
                          ))
                          : <p>Sin maxisacos en bodega.</p>}
                      </div>
                    </article>
                    <article className="rounded-xl bg-white/10 p-4">
                      <p className="font-bold">Pallets de Plumavit listos</p>
                      <p className="mt-2 text-2xl font-black">{formatNumber(palletsListos.length)}</p>
                      <p className="mt-1 text-sm text-emerald-100">
                        {formatNumber(bloquesListos)} bloques de 1 m listos
                      </p>
                    </article>
                  </div>
                </section>
              </div>
            )}

            {activeSection === 'despachos' && (
              <section className="space-y-5 rounded-2xl bg-white p-4 shadow-sm sm:p-6">
                <header>
                  <p className="text-sm font-bold uppercase tracking-wide text-emerald-800">Salida comercial</p>
                  <h2 className="mt-1 text-xl font-black">Despachos de producto terminado</h2>
                  <p className="mt-1 text-sm text-slate-600">Selecciona los productos que salen en una misma guía.</p>
                </header>

                <form onSubmit={handleDispatch} className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-bold text-slate-800">
                      N° Guía de Despacho Salida
                      <input
                        required
                        value={dispatchGuide}
                        onChange={(event) => setDispatchGuide(event.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal uppercase outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                        placeholder="Ej: GD-84920"
                      />
                    </label>
                    <label className="block text-sm font-bold text-slate-800">
                      Cliente / Destino
                      <input
                        required
                        value={dispatchClient}
                        onChange={(event) => setDispatchClient(event.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                        placeholder="Nombre del cliente o destino"
                      />
                    </label>
                  </div>

                  <fieldset className="space-y-3">
                    <legend className="text-sm font-bold text-slate-800">Productos disponibles para cargar</legend>
                    {dispatchItems.length === 0 ? (
                      <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                        No hay maxisacos en bodega ni pallets EPS listos para despacho.
                      </p>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {dispatchItems.map((item) => (
                          <label
                            key={item.key}
                            className={`flex min-h-20 items-start gap-3 rounded-xl border p-4 ${
                              item.available
                                ? 'cursor-pointer border-slate-200 hover:border-emerald-500'
                                : 'cursor-not-allowed border-amber-200 bg-amber-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              disabled={!item.available}
                              checked={selectedItems.includes(item.key)}
                              onChange={() => toggleDispatchItem(item.key)}
                              className="mt-1 h-5 w-5 accent-emerald-800"
                            />
                            <span className="min-w-0">
                              <span className="block font-bold">{item.codigoReferencia}</span>
                              <span className="mt-1 block text-xs font-bold uppercase text-emerald-800">
                                Tipo de Polímero
                              </span>
                              <span className="block text-sm font-semibold text-slate-800">{item.tipoPolimero}</span>
                              <span className="mt-1 block text-sm text-slate-600">
                                {item.tipoProducto === 'PELLET' ? 'Pellet · ' : 'Plumavit EPS · '}{item.detail}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    {!epsWeightAvailable && palletsListos.length > 0 && (
                      <p role="alert" className="text-sm text-amber-800">
                        El peso teórico de EPS-BLOQ no es válido; los pallets EPS no se pueden despachar hasta corregirlo.
                      </p>
                    )}
                  </fieldset>

                  <button
                    type="submit"
                    disabled={savingDispatch || selectedItemsCount === 0 || !supabase}
                    className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 text-base font-black text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto sm:min-w-64"
                  >
                    {savingDispatch
                      ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                      : <Truck className="h-5 w-5" aria-hidden="true" />}
                    Confirmar despacho ({selectedItemsCount})
                  </button>
                </form>

                <div className="border-t border-slate-200 pt-5">
                  <h3 className="font-bold">Últimos despachos registrados</h3>
                  {despachos.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-600">Aún no hay despachos registrados.</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                          <tr>
                            {['numero_guia_salida', 'cliente_destino', 'codigo_referencia', 'tipo_polimero', 'tipo_producto', 'kilos_despachados', 'usuario_nombre'].map((column) => (
                              <th key={column} className="whitespace-nowrap px-3 py-2">
                                {column === 'tipo_polimero' ? 'Tipo de Polímero' : column.replaceAll('_', ' ')}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {[...despachos].reverse().slice(0, 10).map((row, index) => (
                            <tr key={getRecordId(row) || index}>
                              {['numero_guia_salida', 'cliente_destino', 'codigo_referencia', 'tipo_polimero', 'tipo_producto', 'kilos_despachados', 'usuario_nombre'].map((column) => (
                                <td key={column} className="whitespace-nowrap px-3 py-3">{displayCell(row[column])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeSection === 'maestros' && (
              <div className="grid items-start gap-5 xl:grid-cols-2">
                <section className="space-y-5 rounded-2xl bg-white p-4 shadow-sm sm:p-6">
                  <header className="flex items-center gap-3">
                    <span className="rounded-xl bg-emerald-100 p-3 text-emerald-900" aria-hidden="true">
                      <Boxes className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="text-xl font-black">Maestro de Bins</h2>
                      <p className="text-sm text-slate-600">Alta de bins físicos con QR fijo.</p>
                    </div>
                  </header>
                  <button
                    type="button"
                    onClick={() => printBinLabels(bins)}
                    disabled={bins.length === 0}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-emerald-800 px-4 font-bold text-emerald-900 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Printer className="h-5 w-5" aria-hidden="true" />
                    Imprimir Todos los QR
                  </button>
                  <form onSubmit={handleCreateBin} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <label className="text-sm font-bold">
                      Código QR
                      <input
                        required
                        value={binCode}
                        onChange={(event) => setBinCode(event.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 uppercase outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                        placeholder="BIN-11"
                      />
                    </label>
                    <label className="text-sm font-bold">
                      Tara (kg)
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={binTare}
                        onChange={(event) => setBinTare(event.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                        placeholder="Ej: 18"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={savingBin || !supabase}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 font-bold text-white hover:bg-emerald-900 disabled:bg-slate-400"
                    >
                      {savingBin ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Crear Bin
                    </button>
                  </form>
                  <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
                        <tr>
                          <th className="px-3 py-3">Código QR</th>
                          <th className="px-3 py-3">Tara</th>
                          <th className="px-3 py-3">Estado</th>
                          <th className="px-3 py-3">Etiqueta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bins.map((bin) => (
                          <tr key={bin.id_bin}>
                            <td className="px-3 py-3 font-bold">{bin.codigo_qr}</td>
                            <td className="px-3 py-3">{formatNumber(Number(bin.tara_kg) || 0, 2)} kg</td>
                            <td className="px-3 py-3">{bin.estado}</td>
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => printBinLabels([bin])}
                                className="min-h-10 whitespace-nowrap rounded-lg bg-emerald-100 px-3 text-xs font-bold text-emerald-950 hover:bg-emerald-200"
                              >
                                Ver / Imprimir QR
                              </button>
                            </td>
                          </tr>
                        ))}
                        {bins.length === 0 && (
                          <tr><td colSpan="4" className="px-3 py-5 text-slate-600">No hay bins registrados.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="space-y-5 rounded-2xl bg-white p-4 shadow-sm sm:p-6">
                  <header className="flex items-center gap-3">
                    <span className="rounded-xl bg-indigo-100 p-3 text-indigo-900" aria-hidden="true">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="text-xl font-black">Maestro de Personal</h2>
                      <p className="text-sm text-slate-600">Crear cuentas y administrar su acceso.</p>
                    </div>
                  </header>
                  <form onSubmit={handleCreateUser} className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold">
                      Usuario
                      <input
                        required
                        value={newUsername}
                        onChange={(event) => setNewUsername(event.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                      />
                    </label>
                    <label className="text-sm font-bold">
                      Contraseña
                      <input
                        required
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                      />
                    </label>
                    <label className="text-sm font-bold">
                      Nombre completo
                      <input
                        required
                        value={newFullName}
                        onChange={(event) => setNewFullName(event.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                      />
                    </label>
                    <label className="text-sm font-bold">
                      Rol
                      <select
                        value={newRole}
                        onChange={(event) => setNewRole(event.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                      >
                        <option value="OPERARIO">OPERARIO</option>
                        <option value="JEFE">JEFE</option>
                      </select>
                    </label>
                    <button
                      type="submit"
                      disabled={savingUser || !supabase}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-indigo-800 px-4 font-bold text-white hover:bg-indigo-900 disabled:bg-slate-400 sm:col-span-2"
                    >
                      {savingUser ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Crear cuenta activa
                    </button>
                  </form>
                  <div className="space-y-2">
                    {usuarios.map((account) => {
                      const isCurrentUser = String(account.id_usuario) === String(user?.id_usuario)
                      return (
                        <article key={account.id_usuario} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                          <div>
                            <p className="font-bold">{account.nombre_completo}</p>
                            <p className="text-sm text-slate-600">
                              {account.usuario} · {account.rol} · {account.activo ? 'Activa' : 'Inactiva'}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={updatingUserId === account.id_usuario || isCurrentUser}
                            onClick={() => toggleUserActive(account)}
                            title={isCurrentUser ? 'No puedes desactivar tu propia sesión' : undefined}
                            className={`min-h-11 rounded-lg px-3 text-sm font-bold disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 ${
                              account.activo
                                ? 'bg-red-100 text-red-900 hover:bg-red-200'
                                : 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                            }`}
                          >
                            {updatingUserId === account.id_usuario
                              ? 'Guardando...'
                              : account.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        </article>
                      )
                    })}
                    {usuarios.length === 0 && (
                      <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No hay cuentas de personal.</p>
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeSection === 'historial' && (
              <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
                <div className="border-b border-slate-200 p-4 sm:p-5">
                  <h2 className="text-lg font-bold">Historial de operaciones</h2>
                  <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                    {tableDefinitions.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setActiveTable(id)
                          setSearch('')
                        }}
                        aria-pressed={activeTable === id}
                        className={`min-h-10 shrink-0 rounded-lg px-4 text-sm font-bold ${
                          activeTable === id
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="relative mt-3 max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                    <input
                      type="search"
                      aria-label={`Filtrar ${activeLabel}`}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={`Filtrar ${activeLabel.toLocaleLowerCase('es-CL')}...`}
                      className="min-h-11 w-full rounded-xl border border-slate-300 pl-10 pr-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                    />
                  </div>
                </div>

                {filteredRows.length === 0 ? (
                  <p className="p-6 text-sm text-slate-600">
                    {selectedRows.length === 0 ? 'No hay registros para mostrar.' : 'No se encontraron coincidencias.'}
                  </p>
                ) : (
                  <div className="max-h-[65vh] overflow-auto">
                    <table className="min-w-full border-collapse text-left text-sm">
                      <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
                        <tr>
                          {columns.map((column) => (
                            <th key={column} scope="col" className="whitespace-nowrap px-4 py-3 font-bold">
                            {column === 'tipo_polimero' ? 'Tipo de Polímero' : column.replaceAll('_', ' ')}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredRows.map((row, rowIndex) => (
                          <tr key={getRecordId(row) || rowIndex}>
                            {columns.map((column) => (
                              <td key={column} className="max-w-xs whitespace-nowrap px-4 py-3 text-slate-700">
                                <span className="block truncate" title={displayCell(row[column])}>
                                  {displayCell(row[column])}
                                </span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
                  {formatNumber(filteredRows.length)} de {formatNumber(selectedRows.length)} registros
                </p>
              </section>
            )}
          </>
        )}
      </div>
      <style>{`
        .qr-print-root { display: none; }
        @media print {
          @page { size: A4; margin: 12mm; }
          body * { visibility: hidden !important; }
          .qr-print-root,
          .qr-print-root * { visibility: visible !important; }
          .qr-print-root {
            display: block !important;
            position: absolute;
            inset: 0;
            width: 100%;
            background: white;
          }
          .qr-print-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10mm;
          }
          .qr-print-card {
            break-inside: avoid;
            display: flex;
            min-height: 95mm;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            border: 1px solid #cbd5e1;
            padding: 8mm;
            text-align: center;
          }
        }
      `}</style>
      <section className="qr-print-root" aria-label="Etiquetas QR para bins">
        <div className="qr-print-grid">
          {(binsToPrint ?? []).map((bin) => (
            <article key={bin.id_bin} className="qr-print-card">
              <QRCodeSVG value={bin.codigo_qr} size={220} level="M" includeMargin />
              <p className="mt-4 text-4xl font-black">{bin.codigo_qr}</p>
              <p className="mt-2 text-xl font-bold">
                Tara: {formatNumber(Number(bin.tara_kg) || 0, 2)} kg
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
