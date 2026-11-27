import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Download,
  FileClock,
  Flame,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Search,
  Truck,
  Weight,
} from 'lucide-react'
import { supabase, supabaseConfigurationError } from '../lib/supabaseClient'

const pageSize = 500
const tableDefinitions = [
  { id: 'recepciones_guia', label: 'Recepciones', sheet: 'Recepciones' },
  { id: 'pesajes_scrap', label: 'Pesajes Scrap', sheet: 'Pesajes Scrap' },
  { id: 'corridas_extrusion', label: 'Corridas Extrusión', sheet: 'Corridas Extrusion' },
  { id: 'pallets_eps', label: 'Pallets EPS', sheet: 'Pallets EPS' },
  { id: 'logs_auditoria', label: 'Auditoría', sheet: 'Auditoria' },
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

export default function DashboardJefatura() {
  const [historiales, setHistoriales] = useState({})
  const [activeTable, setActiveTable] = useState(tableDefinitions[0].id)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (!supabase) {
      setError(supabaseConfigurationError)
      setLoading(false)
      return
    }

    if (!silent) setLoading(true)
    setError('')

    try {
      const results = await Promise.all(tableDefinitions.map(async ({ id }) => {
        const allRows = []
        let offset = 0
        let totalCount = null

        while (totalCount === null || offset < totalCount) {
          const { data, error: queryError, count } = await supabase
            .from(id)
            .select('*', { count: 'exact' })
            .range(offset, offset + pageSize - 1)

          if (queryError) throw new Error(`No se pudo consultar ${id}: ${queryError.message}`)
          const rows = data ?? []
          if (totalCount === null) totalCount = count ?? rows.length
          allRows.push(...rows)
          offset += rows.length
          if (rows.length === 0) break
        }

        return [id, allRows]
      }))

      setHistoriales(Object.fromEntries(results))
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
    const channel = supabase
      ? tableDefinitions.reduce(
        (currentChannel, { id }) => currentChannel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: id },
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

    async function initialLoad() {
      await loadDashboard()
    }

    initialLoad()

    return () => {
      active = false
      window.clearTimeout(refreshTimer)
      if (channel) supabase.removeChannel(channel)
    }
  }, [loadDashboard])

  const recepciones = historiales.recepciones_guia ?? []
  const pesajes = historiales.pesajes_scrap ?? []
  const corridas = historiales.corridas_extrusion ?? []
  const pallets = historiales.pallets_eps ?? []
  const kilosAceptados = sumField(recepciones, 'kilos_teoricos_aceptados')
  const kilosRechazados = sumField(recepciones, 'kilos_teoricos_rechazados')
  const pesajesEnEspera = pesajes.filter((row) => row.estado_consumo === 'EN_ESPERA_HORNO')
  const kilosEnEspera = pesajesEnEspera.reduce(
    (total, row) => total + (Number(row.peso_bruto_kg) - Number(row.tara_aplicada_kg)),
    0,
  )
  const kilosPellet = sumField(corridas, 'kilos_pellet_maxisaco')
  const corridasConMerma = corridas.filter((row) => Number.isFinite(Number(row.porcentaje_merma)))
  const mermaPromedio = corridasConMerma.length
    ? sumField(corridasConMerma, 'porcentaje_merma') / corridasConMerma.length
    : 0
  const palletsCompletos = pallets.filter((row) => row.estado === 'COMPLETO').length

  const selectedRows = useMemo(
    () => historiales[activeTable] ?? [],
    [activeTable, historiales],
  )
  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('es-CL')
    if (!normalizedSearch) return selectedRows
    return selectedRows.filter((row) => (
      JSON.stringify(row).toLocaleLowerCase('es-CL').includes(normalizedSearch)
    ))
  }, [search, selectedRows])
  const columns = selectedRows.length > 0 ? Object.keys(selectedRows[0]) : []
  const activeLabel = tableDefinitions.find((table) => table.id === activeTable)?.label ?? ''

  async function exportHistory() {
    setExporting(true)
    setError('')

    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.utils.book_new()
      tableDefinitions.forEach(({ id, sheet }) => {
        const rows = historiales[id] ?? []
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

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-emerald-800">Vista ejecutiva · Solo lectura</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Panel de Jefatura</h1>
            <p className="mt-2 text-sm text-slate-600">
              Indicadores actualizados en tiempo real
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

        {loading ? (
          <section className="flex items-center gap-3 rounded-2xl bg-white p-8 text-slate-600 shadow-sm" role="status">
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            Cargando indicadores e historial...
          </section>
        ) : (
          <>
            <section aria-label="Indicadores clave" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
                label="Pallets EPS completos"
                value={formatNumber(palletsCompletos)}
                detail="Listos para traslado"
                Icon={PackageCheck}
                tone="bg-indigo-100 text-indigo-900"
              />
            </section>

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
                            {column.replaceAll('_', ' ')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRows.map((row, rowIndex) => (
                        <tr key={row.id_registro ?? row.id_recepcion ?? row.id_pesaje ?? row.id_corrida ?? row.id_pallet ?? rowIndex}>
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
          </>
        )}
      </div>
    </main>
  )
}
