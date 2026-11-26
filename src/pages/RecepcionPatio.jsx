import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  LoaderCircle,
  Recycle,
  Truck,
  Weight,
} from 'lucide-react'
import { supabase, supabaseConfigurationError } from '../lib/supabaseClient'

const initialForm = {
  numero_guia: '',
  id_proveedor: '',
  id_tipo_residuo: '',
  cantidad_aceptada: '',
  cantidad_rechazada_vertedero: '0',
}

const numberFormat = new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 2,
})

function formatKg(value) {
  return `${numberFormat.format(value)} kg`
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'
}

export default function RecepcionPatio() {
  const [proveedores, setProveedores] = useState([])
  const [tiposResiduo, setTiposResiduo] = useState([])
  const [guias, setGuias] = useState([])
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const tipoSeleccionado = useMemo(
    () => tiposResiduo.find(
      (tipo) => String(tipo.id_tipo_residuo) === form.id_tipo_residuo,
    ),
    [form.id_tipo_residuo, tiposResiduo],
  )

  const cantidadAceptada = Number(form.cantidad_aceptada) || 0
  const cantidadRechazada = Number(form.cantidad_rechazada_vertedero) || 0
  const pesoUnitario = Number(tipoSeleccionado?.peso_teorico_unidad_kg) || 0
  const kilosAceptados = cantidadAceptada * pesoUnitario
  const kilosRechazados = cantidadRechazada * pesoUnitario

  async function loadGuias() {
    const { data, error: queryError } = await supabase
      .from('recepciones_guia')
      .select(`
        id_recepcion,
        numero_guia,
        cantidad_aceptada,
        cantidad_rechazada_vertedero,
        kilos_teoricos_aceptados,
        kilos_teoricos_rechazados,
        creado_en,
        proveedores ( razon_social ),
        tipos_residuo ( codigo, nombre )
      `)
      .order('id_recepcion', { ascending: false })
      .limit(5)

    if (queryError) throw queryError
    setGuias(data ?? [])
  }

  useEffect(() => {
    let active = true

    async function loadPageData() {
      setLoading(true)
      setError('')

      if (!supabase) {
        setLoading(false)
        return
      }

      try {
        const [proveedoresResult, tiposResult] = await Promise.all([
          supabase
            .from('proveedores')
            .select('id_proveedor, rut_empresa, razon_social')
            .order('razon_social'),
          supabase
            .from('tipos_residuo')
            .select('id_tipo_residuo, codigo, nombre, peso_teorico_unidad_kg')
            .order('nombre'),
        ])

        if (proveedoresResult.error) throw proveedoresResult.error
        if (tiposResult.error) throw tiposResult.error

        const { data, error: guiasError } = await supabase
          .from('recepciones_guia')
          .select(`
            id_recepcion,
            numero_guia,
            cantidad_aceptada,
            cantidad_rechazada_vertedero,
            kilos_teoricos_aceptados,
            kilos_teoricos_rechazados,
            creado_en,
            proveedores ( razon_social ),
            tipos_residuo ( codigo, nombre )
          `)
          .order('id_recepcion', { ascending: false })
          .limit(5)

        if (guiasError) throw guiasError
        if (!active) return

        setProveedores(proveedoresResult.data ?? [])
        setTiposResiduo(tiposResult.data ?? [])
        setGuias(data ?? [])
      } catch (loadError) {
        if (active) setError(`No se pudieron cargar los datos: ${getErrorMessage(loadError)}`)
      } finally {
        if (active) setLoading(false)
      }
    }

    loadPageData()

    return () => {
      active = false
    }
  }, [])

  function updateForm(event) {
    const { name, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: name === 'numero_guia' ? value.toUpperCase() : value,
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setNotice('')

    if (!supabase) {
      setError(supabaseConfigurationError)
      return
    }

    setSaving(true)

    const recepcion = {
      numero_guia: form.numero_guia.trim().toUpperCase(),
      id_proveedor: form.id_proveedor,
      id_tipo_residuo: form.id_tipo_residuo,
      cantidad_aceptada: cantidadAceptada,
      cantidad_rechazada_vertedero: cantidadRechazada,
      kilos_teoricos_aceptados: kilosAceptados,
      kilos_teoricos_rechazados: kilosRechazados,
    }

    try {
      const { data: nuevaRecepcion, error: insertError } = await supabase
        .from('recepciones_guia')
        .insert(recepcion)
        .select(`
          id_recepcion,
          numero_guia,
          cantidad_aceptada,
          cantidad_rechazada_vertedero,
          kilos_teoricos_aceptados,
          kilos_teoricos_rechazados,
          creado_en
        `)
        .single()

      if (insertError) throw insertError

      const { error: auditError } = await supabase
        .from('logs_auditoria')
        .insert({
          tabla_afectada: 'recepciones_guia',
          operacion: 'INSERT',
          datos_nuevos: nuevaRecepcion,
          usuario_nombre: 'Operario Patio',
        })

      if (auditError) {
        setForm(initialForm)
        try {
          await loadGuias()
        } catch (refreshError) {
          setError(`La recepción se guardó, pero falló la auditoría y no se pudo actualizar la lista: ${getErrorMessage(refreshError)}`)
          return
        }
        setError(`La recepción se guardó, pero falló el registro de auditoría: ${getErrorMessage(auditError)}`)
        return
      }

      setForm(initialForm)
      setNotice('Recepción registrada correctamente.')
      try {
        await loadGuias()
      } catch (refreshError) {
        setError(`La recepción y su auditoría se guardaron, pero no se pudo actualizar la lista: ${getErrorMessage(refreshError)}`)
      }
    } catch (submitError) {
      setError(`No se pudo completar la recepción: ${getErrorMessage(submitError)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="rounded-2xl bg-emerald-800 p-5 text-white shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/15 p-3" aria-hidden="true">
              <Recycle className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-100">GreenSpot · Puerto Montt</p>
              <h1 className="text-2xl font-bold tracking-tight">Recepción en patio</h1>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-2 text-sm text-emerald-100">
            <Truck className="h-4 w-4" aria-hidden="true" />
            Registro de ingreso de camiones
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
          <h2 className="mb-5 text-lg font-bold">Nueva guía</h2>
          {loading ? (
            <div className="flex items-center gap-3 py-8 text-slate-600" role="status">
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
              Cargando proveedores y residuos...
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="numero_guia" className="mb-2 block text-sm font-semibold">
                  Número de guía
                </label>
                <input
                  id="numero_guia"
                  name="numero_guia"
                  type="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  required
                  value={form.numero_guia}
                  onChange={updateForm}
                  placeholder="Ej. GD-001234"
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base uppercase outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                />
              </div>

              <div>
                <label htmlFor="id_proveedor" className="mb-2 block text-sm font-semibold">
                  Proveedor
                </label>
                <select
                  id="id_proveedor"
                  name="id_proveedor"
                  required
                  value={form.id_proveedor}
                  onChange={updateForm}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                >
                  <option value="">Selecciona un proveedor</option>
                  {proveedores.map((proveedor) => (
                    <option key={proveedor.id_proveedor} value={proveedor.id_proveedor}>
                      {proveedor.razon_social} · {proveedor.rut_empresa}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="id_tipo_residuo" className="mb-2 block text-sm font-semibold">
                  Tipo de residuo
                </label>
                <select
                  id="id_tipo_residuo"
                  name="id_tipo_residuo"
                  required
                  value={form.id_tipo_residuo}
                  onChange={updateForm}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                >
                  <option value="">Selecciona un residuo</option>
                  {tiposResiduo.map((tipo) => (
                    <option key={tipo.id_tipo_residuo} value={tipo.id_tipo_residuo}>
                      {tipo.codigo} · {tipo.nombre} · {formatKg(Number(tipo.peso_teorico_unidad_kg))}
                      /unidad
                    </option>
                  ))}
                </select>
                {tipoSeleccionado && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                    <Weight className="h-4 w-4" aria-hidden="true" />
                    Peso teórico unitario: {formatKg(pesoUnitario)}
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cantidad_aceptada" className="mb-2 block text-sm font-semibold">
                    Cantidad aceptada
                  </label>
                  <input
                    id="cantidad_aceptada"
                    name="cantidad_aceptada"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    required
                    value={form.cantidad_aceptada}
                    onChange={updateForm}
                    placeholder="0"
                    className="min-h-12 w-full rounded-xl border border-slate-300 px-4 text-lg outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  />
                </div>
                <div>
                  <label htmlFor="cantidad_rechazada_vertedero" className="mb-2 block text-sm font-semibold">
                    Rechazada a vertedero
                  </label>
                  <input
                    id="cantidad_rechazada_vertedero"
                    name="cantidad_rechazada_vertedero"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={form.cantidad_rechazada_vertedero}
                    onChange={updateForm}
                    className="min-h-12 w-full rounded-xl border border-slate-300 px-4 text-lg outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-slate-600">Kilos teóricos aceptados</p>
                  <p className="mt-1 text-xl font-bold text-emerald-800">{formatKg(kilosAceptados)}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Kilos teóricos rechazados</p>
                  <p className="mt-1 text-xl font-bold text-slate-800">{formatKg(kilosRechazados)}</p>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || proveedores.length === 0 || tiposResiduo.length === 0}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 text-base font-bold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {saving ? (
                  <>
                    <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                    Guardando recepción...
                  </>
                ) : (
                  <>
                    <ClipboardList className="h-5 w-5" aria-hidden="true" />
                    Registrar recepción
                  </>
                )}
              </button>
            </form>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-lg font-bold">Últimas guías</h2>
          {guias.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              Aún no hay guías registradas.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {guias.map((guia) => (
                <li key={guia.id_recepcion} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{guia.numero_guia}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {guia.proveedores?.razon_social ?? 'Proveedor'}
                      </p>
                      <p className="text-sm text-slate-600">
                        {guia.tipos_residuo?.codigo} · {guia.tipos_residuo?.nombre}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold">{formatKg(Number(guia.kilos_teoricos_aceptados) || 0)}</p>
                      <p className="mt-1 text-xs text-slate-500">aceptados</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
