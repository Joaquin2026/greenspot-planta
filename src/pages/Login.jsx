import { useState } from 'react'
import {
  AlertCircle,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Recycle,
  UserRound,
} from 'lucide-react'
import { supabase, supabaseConfigurationError } from '../lib/supabaseClient'

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'
}

export default function Login({ onLogin }) {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!supabase) {
      setError(supabaseConfigurationError)
      return
    }

    setLoading(true)
    try {
      const { data, error: loginError } = await supabase
        .from('usuarios_planta')
        .select('id_usuario, usuario, nombre_completo, rol')
        .eq('usuario', usuario.trim())
        .eq('clave', clave)
        .eq('activo', true)
        .maybeSingle()

      if (loginError) throw loginError
      if (!data) {
        setError('Usuario o contraseña incorrectos')
        return
      }

      const role = String(data.rol ?? '').toUpperCase()
      if (!['OPERARIO', 'JEFE'].includes(role)) {
        setError('El usuario no tiene un rol válido. Contacta a Jefatura.')
        return
      }

      const user = {
        id_usuario: data.id_usuario,
        usuario: data.usuario,
        nombre_completo: data.nombre_completo,
        rol: role,
      }

      try {
        localStorage.setItem('greenspot_user', JSON.stringify(user))
      } catch {
        setError('No se pudo guardar la sesión en este dispositivo. Habilita el almacenamiento local e inténtalo nuevamente.')
        return
      }

      onLogin(user)
    } catch (loginError) {
      setError(`No se pudo validar el acceso: ${getErrorMessage(loginError)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8 text-slate-900">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
        <section className="flex flex-col justify-between bg-emerald-800 p-7 text-white sm:p-10">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/15 p-3" aria-hidden="true">
              <Recycle className="h-7 w-7" />
            </div>
            <div>
              <p className="text-lg font-bold">GreenSpot Planta</p>
              <p className="text-sm text-emerald-100">Puerto Montt</p>
            </div>
          </div>
          <div className="mt-10">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">
              Operación industrial
            </p>
            <h1 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">
              Gestión responsable de materiales.
            </h1>
            <p className="mt-4 max-w-md text-emerald-100">
              Accede a las estaciones de planta o a los indicadores ejecutivos según tu perfil.
            </p>
          </div>
          <p className="mt-10 text-xs text-emerald-200">Plataforma operacional · Acceso autorizado</p>
        </section>

        <section className="p-6 sm:p-10">
          <div className="mb-7">
            <p className="text-sm font-semibold text-emerald-800">Bienvenido</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">Iniciar sesión</h2>
            <p className="mt-2 text-sm text-slate-600">Ingresa tus credenciales de planta.</p>
          </div>

          {error && (
            <div role="alert" className="mb-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="login-usuario" className="mb-2 block text-sm font-bold text-slate-800">
                Usuario
              </label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <input
                  id="login-usuario"
                  name="usuario"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  required
                  value={usuario}
                  onChange={(event) => setUsuario(event.target.value)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 py-3 pl-12 pr-4 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  placeholder="Tu usuario"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-clave" className="mb-2 block text-sm font-bold text-slate-800">
                Contraseña
              </label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <input
                  id="login-clave"
                  name="clave"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={clave}
                  onChange={(event) => setClave(event.target.value)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 py-3 pl-12 pr-12 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  placeholder="Tu contraseña"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                >
                  {showPassword
                    ? <EyeOff className="h-5 w-5" aria-hidden="true" />
                    : <Eye className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 text-base font-bold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-wait disabled:bg-slate-400"
            >
              {loading && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />}
              Ingresar al Sistema
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
