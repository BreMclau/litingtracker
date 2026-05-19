import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://ebppujmhtkvtxrylwght.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_Sm86cb8aJpGWHvft1nKRog_XF9-GQEW'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storageKey: 'legacy-listing-tracker-auth',
    persistSession: true,
    autoRefreshToken: true,
  },
})

// Separate client used by the admin "Invite User" flow so signUp()
// doesn't replace the admin's own session.
export const createInviteClient = () =>
  createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storageKey: 'legacy-listing-tracker-invite-temp',
      persistSession: false,
      autoRefreshToken: false,
    },
  })
