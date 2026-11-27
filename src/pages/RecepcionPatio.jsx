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

function formatFolioInterno(id) {
  return `REC-${String((Number(id) || 0) + 1).padStart(4, '0')}`
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'
}

export default function RecepcionPatio({ user }) {
  const [proveedores, setProveedores] = useState([])
  const [tiposResiduo, setTiposResiduo] = useState([])
  const [guias, setGuias] = useState([])
  const [nextFolio, setNextFolio] = useState('REC-0001')
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
  const kilosUltimasRecepciones = guias.reduce(
    (totals, guia) => ({
      aceptados: totals.aceptados + (Number(guia.kilos_teoricos_aceptados) || 0),
      rechazados: totals.rechazados + (Number(guia.kilos_teoricos_rechazados) || 0),
    }),
    { aceptados: 0, rechazados: 0 },
  )

  async function getNextFolio() {
    const { data, error: queryError } = await supabase
      .from('recepciones_guia')
      .select('id_recepcion')
      .order('id_recepcion', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (queryError) throw queryError
    return formatFolioInterno(data?.id_recepcion)
  }

  async function loadGuias() {
    const { data, error: queryError } = await supabase
      .from('recepciones_guia')
      .select(`
        id_recepcion,
        folio_interno,
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
        const [proveedoresResult, tiposResult, latestReceiptResult] = await Promise.all([
          supabase
            .from('proveedores')
            .select('id_proveedor, rut_empresa, razon_social')
            .order('razon_social'),
          supabase
            .from('tipos_residuo')
            .select('id_tipo_residuo, codigo, nombre, peso_teorico_unidad_kg')
            .neq('codigo', 'EPS-BLOQ')
            .order('nombre'),
          supabase
            .from('recepciones_guia')
            .select('id_recepcion')
            .order('id_recepcion', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

        if (proveedoresResult.error) throw proveedoresResult.error
        if (tiposResult.error) throw tiposResult.error
        if (latestReceiptResult.error) throw latestReceiptResult.error

        const { data, error: guiasError } = await supabase
          .from('recepciones_guia')
          .select(`
            id_recepcion,
            folio_interno,
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
        setNextFolio(formatFolioInterno(latestReceiptResult.data?.id_recepcion))
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

    try {
      const folioInterno = await getNextFolio()
      const recepcion = {
        folio_interno: folioInterno,
        numero_guia: form.numero_guia.trim().toUpperCase(),
        id_proveedor: form.id_proveedor,
        id_tipo_residuo: form.id_tipo_residuo,
        cantidad_aceptada: cantidadAceptada,
        cantidad_rechazada_vertedero: cantidadRechazada,
        kilos_teoricos_aceptados: kilosAceptados,
        kilos_teoricos_rechazados: kilosRechazados,
      }

      const { data: nuevaRecepcion, error: insertError } = await supabase
        .from('recepciones_guia')
        .insert(recepcion)
        .select(`
          id_recepcion,
          folio_interno,
          numero_guia,
          cantidad_aceptada,
          cantidad_rechazada_vertedero,
          kilos_teoricos_aceptados,
          kilos_teoricos_rechazados,
          creado_en
        `)
        .single()

      if (insertError) throw insertError
      setNextFolio(formatFolioInterno(nuevaRecepcion.id_recepcion))

      const { error: auditError } = await supabase
        .from('logs_auditoria')
        .insert({
          tabla_afectada: 'recepciones_guia',
          id_registro: Number(nuevaRecepcion?.id_recepcion) || 0,
          operacion: 'INSERT',
          datos_nuevos: nuevaRecepcion,
          usuario_nombre: user.nombre_completo,
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
            Registro inicial de ingreso · el acopio y seguimiento en patio se controlan en kg
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
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Nueva recepción</h2>
            <span className="rounded-full bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-900">
              Folio Interno Automático: {nextFolio}
            </span>
          </div>
          {loading ? (
            <div className="flex items-center gap-3 py-8 text-slate-600" role="status">
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
              Cargando proveedores y residuos...
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="numero_guia" className="mb-2 block text-sm font-semibold">
                  N° Guía de Despacho del Camión (Documento SII / Transportista)
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
                  placeholder="Ej: GD-84920"
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
                    Unidades descargadas aceptadas
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
                    Unidades rechazadas a vertedero
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

              <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950">
                Las unidades se usan solo como dato de descarga para calcular los kilos teóricos iniciales. El acopio en patio y todo seguimiento posterior se mide exclusivamente en kg.
              </p>

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
          <div className="mb-4">
            <h2 className="text-lg font-bold">Últimas guías</h2>
            <p className="mt-1 text-sm text-slate-600">El acopio se muestra en kilos; las unidades quedan como referencia histórica de descarga.</p>
          </div>
          {guias.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              Aún no hay guías registradas.
            </p>
          ) : (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-bold text-emerald-900">Acopio teórico aceptado · últimas 5 guías</p>
                  <p className="mt-1 text-2xl font-black text-emerald-950">{formatKg(kilosUltimasRecepciones.aceptados)}</p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-bold text-slate-700">Rechazo teórico · últimas 5 guías</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{formatKg(kilosUltimasRecepciones.rechazados)}</p>
                </article>
              </div>
              <ul className="divide-y divide-slate-200">
                {guias.map((guia) => (
                  <li key={guia.id_recepcion} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase text-slate-500">Folio Interno</p>
                        <p className="truncate font-bold text-emerald-900">{guia.folio_interno}</p>
                        <p className="mt-2 text-xs font-semibold uppercase text-slate-500">Guía Camión</p>
                        <p className="truncate font-semibold">{guia.numero_guia}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {guia.proveedores?.razon_social ?? 'Proveedor'}
                        </p>
                        <p className="text-sm text-slate-600">
                          {guia.tipos_residuo?.codigo} · {guia.tipos_residuo?.nombre}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-semibold uppercase text-emerald-800">Acopio aceptado</p>
                        <p className="text-xl font-black text-emerald-900">
                          {formatKg(Number(guia.kilos_teoricos_aceptados) || 0)}
                        </p>
                        <p className="text-xs text-slate-500">
                          Descarga inicial: {Number(guia.cantidad_aceptada) || 0} unidades
                        </p>
                        <p className="mt-2 font-semibold">
                          Rechazados: {formatKg(Number(guia.kilos_teoricos_rechazados) || 0)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {Number(guia.cantidad_rechazada_vertedero) || 0} unidades de descarga
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
