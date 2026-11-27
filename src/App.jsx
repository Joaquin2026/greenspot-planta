import { useState } from 'react'
import {
  AlertCircle,
  Boxes,
  Cog,
  Flame,
  LogOut,
  Recycle,
  Truck,
} from 'lucide-react'
import { supabaseConfigurationError } from './lib/supabaseClient'
import DashboardJefatura from './pages/DashboardJefatura'
import ExtrusionSilo from './pages/ExtrusionSilo'
import Login from './pages/Login'
import MolinoScrap from './pages/MolinoScrap'
import PlumavitEPS from './pages/PlumavitEPS'
import RecepcionPatio from './pages/RecepcionPatio'

const operatorTabs = [
  { id: 'patio', label: 'Patio', Icon: Truck },
  { id: 'molino', label: 'Molino', Icon: Cog },
  { id: 'horno', label: 'Horno / Silo', Icon: Flame },
  { id: 'plumavit', label: 'Plumavit', Icon: Boxes },
]

function getStoredUser() {
  try {
    const stored = localStorage.getItem('greenspot_user')
    if (!stored) return null

    const user = JSON.parse(stored)
    if (
      !user
      || !user.id_usuario
      || !user.usuario
      || !user.nombre_completo
      || !['OPERARIO', 'JEFE'].includes(user.rol)
    ) {
      return null
    }

    return user
  } catch {
    return null
  }
}

function App() {
  const [user, setUser] = useState(getStoredUser)
  const [activeTab, setActiveTab] = useState('patio')
  const [visitedTabs, setVisitedTabs] = useState(['patio'])

  function handleLogin(authenticatedUser) {
    setUser(authenticatedUser)
    setActiveTab('patio')
    setVisitedTabs(['patio'])
  }

  function handleLogout() {
    try {
      localStorage.removeItem('greenspot_user')
    } catch (error) {
      console.error('No se pudo borrar la sesión almacenada:', error)
    }
    setUser(null)
    setActiveTab('patio')
    setVisitedTabs(['patio'])
  }

  function selectTab(tabId) {
    setActiveTab(tabId)
    setVisitedTabs((current) => (
      current.includes(tabId) ? current : [...current, tabId]
    ))
  }

  if (!user) return <Login onLogin={handleLogin} />

  const isManager = user.rol === 'JEFE'

  return (
    <div className={`min-h-screen bg-slate-100 ${isManager ? '' : 'pb-24 md:pb-8'}`}>
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

          <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">{user.nombre_completo}</p>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                isManager ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900'
              }`}>
                {user.rol}
              </span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Cerrar Sesión
            </button>
          </div>
        </div>
      </header>

      {supabaseConfigurationError && (
        <div role="alert" className="mx-auto mt-4 flex max-w-7xl gap-3 px-4 text-sm text-amber-900 sm:px-6">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{supabaseConfigurationError}</p>
        </div>
      )}

      {isManager ? (
        <DashboardJefatura />
      ) : (
        <>
          <nav
            aria-label="Navegación principal"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.08)] md:sticky md:top-0 md:bottom-auto md:border-t-0 md:border-b md:px-6 md:shadow-sm"
          >
            <div className="mx-auto grid max-w-7xl grid-cols-4 md:gap-2">
              {operatorTabs.map(({ id, label, Icon }) => {
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

          <div className="mx-auto max-w-7xl">
            {operatorTabs.map(({ id }) => visitedTabs.includes(id) && (
              <div key={id} hidden={activeTab !== id}>
                {id === 'patio' && <RecepcionPatio user={user} />}
                {id === 'molino' && <MolinoScrap user={user} />}
                {id === 'horno' && <ExtrusionSilo user={user} />}
                {id === 'plumavit' && <PlumavitEPS user={user} />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default App
