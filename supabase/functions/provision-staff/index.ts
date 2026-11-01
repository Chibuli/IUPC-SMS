import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { createStaffHandler } from './handler.ts'

Deno.serve(createStaffHandler(createClient, name => Deno.env.get(name)))
