import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

export const supabaseConfigurationError =
  !supabaseUrl || !supabaseAnonKey
    ? 'Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en un archivo .env y reinicia Vite.'
    : ''

export const supabase = supabaseConfigurationError
  ? null
  : createClient(supabaseUrl, supabaseAnonKey)

if (supabaseConfigurationError) {
  console.warn(`[GreenSpot] Supabase no está configurado. ${supabaseConfigurationError}`)
}
