import { useState } from 'react'
import {
  AlertCircle,
  Boxes,
  Cog,
  Download,
  Flame,
  LoaderCircle,
  Recycle,
  Truck,
} from 'lucide-react'
import { supabase, supabaseConfigurationError } from './lib/supabaseClient'
import ExtrusionSilo from './pages/ExtrusionSilo'
import MolinoScrap from './pages/MolinoScrap'
import PlumavitEPS from './pages/PlumavitEPS'
import RecepcionPatio from './pages/RecepcionPatio'

const tabs = [
  { id: 'patio', label: 'Patio', Icon: Truck },
  { id: 'molino', label: 'Molino', Icon: Cog },
  { id: 'horno', label: 'Horno / Silo', Icon: Flame },
  { id: 'plumavit', label: 'Plumavit', Icon: Boxes },
]

function App() {
  const [activeTab, setActiveTab] = useState('patio')
  const [visitedTabs, setVisitedTabs] = useState(['patio'])
  const [role, setRole] = useState('operator')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  function selectTab(tabId) {
    setActiveTab(tabId)
    setVisitedTabs((current) => (
      current.includes(tabId) ? current : [...current, tabId]
    ))
  }

  async function exportReports() {
    setExportError('')
    setExporting(true)

    const tables = [
      { name: 'Recepciones', table: 'recepciones_guia' },
      { name: 'Pesajes Scrap', table: 'pesajes_scrap' },
      { name: 'Corridas Extrusion', table: 'corridas_extrusion' },
    ]

    try {
      const XLSX = await import('xlsx')
      const results = await Promise.all(
        tables.map(({ table }) => supabase.from(table).select('*')),
      )
      const failedTable = results.findIndex((result) => result.error)
      if (failedTable !== -1) {
        throw new Error(
          `No se pudo consultar ${tables[failedTable].table}: ${results[failedTable].error.message}`,
        )
      }

      const workbook = XLSX.utils.book_new()
      results.forEach((result, index) => {
        const rows = result.data ?? []
        const worksheet = rows.length
          ? XLSX.utils.json_to_sheet(rows)
          : XLSX.utils.aoa_to_sheet([['Sin registros']])
        XLSX.utils.book_append_sheet(workbook, worksheet, tables[index].name)
      })

      const date = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(workbook, `greenspot-reporte-${date}.xlsx`)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'No se pudo generar el archivo Excel.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-24 md:pb-8">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-800 p-2 text-white" aria-hidden="true">
              <Recycle className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-slate-900">GreenSpot Planta</p>
              <p className="text-xs text-slate-600">Puerto Montt</p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label htmlFor="app-role" className="sr-only">Perfil de usuario</label>
            <select
              id="app-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="min-h-11 min-w-48 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 sm:flex-none"
            >
              <option value="operator">Operario Planta</option>
              <option value="manager">Jefatura (Carlos Araya)</option>
            </select>
            {role === 'manager' && (
              <button
                type="button"
                onClick={exportReports}
                disabled={exporting || !supabase}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 text-sm font-bold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-wait disabled:bg-slate-400 sm:flex-none"
              >
                {exporting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-4 w-4" aria-hidden="true" />
                )}
                Descargar Excel
              </button>
            )}
          </div>
        </div>
      </header>

      {supabaseConfigurationError && (
        <div
          role="alert"
          className="mx-auto mt-4 flex max-w-7xl gap-3 px-4 text-sm text-amber-900 sm:px-6"
        >
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{supabaseConfigurationError}</p>
        </div>
      )}

      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.08)] md:sticky md:top-0 md:bottom-auto md:border-t-0 md:border-b md:px-6 md:shadow-sm"
      >
        <div className="mx-auto grid max-w-7xl grid-cols-4 md:gap-2">
          {tabs.map(({ id, label, Icon }) => {
            const selected = activeTab === id
            return (
              <button
                key={id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => selectTab(id)}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs font-semibold transition-colors md:min-h-14 md:flex-row md:gap-2 md:rounded-xl md:px-4 md:text-sm ${
                  selected
                    ? 'text-emerald-900 md:bg-emerald-50'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {exportError && (
        <div role="alert" className="mx-auto mt-4 flex max-w-7xl gap-3 px-4 text-sm text-red-800 sm:px-6">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{exportError}</p>
        </div>
      )}

      <div className="mx-auto max-w-7xl">
        {tabs.map(({ id }) => visitedTabs.includes(id) && (
          <div key={id} hidden={activeTab !== id}>
            {id === 'patio' && <RecepcionPatio />}
            {id === 'molino' && <MolinoScrap />}
            {id === 'horno' && <ExtrusionSilo />}
            {id === 'plumavit' && <PlumavitEPS />}
          </div>
        ))}
      </div>
    </div>
  )
}

export default App