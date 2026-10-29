import { createHandler } from './handler.ts';
// New independently rotatable keys are preferred; legacy is a compatibility fallback.
const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
const secretKey = keys.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!secretKey) throw new Error('Supabase backend credential is missing');
Deno.serve(createHandler({ url: Deno.env.get('SUPABASE_URL')!, secretKey }));
