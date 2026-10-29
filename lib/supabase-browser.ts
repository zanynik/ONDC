import { createClient } from '@supabase/supabase-js';
// Publishable keys identify the project; table access is enforced by Postgres RLS.
export const supabaseUrl = 'https://ynmevkntztzfutjnbfnf.supabase.co';
export const supabasePublishableKey = 'sb_publishable_1EcvJMjK4PNINhOLqNKbKA_sKET4kf3';
export function createBrowserClient() {
  return createClient(supabaseUrl, supabasePublishableKey);
}
