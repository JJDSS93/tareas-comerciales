import { createClient } from 'npm:@supabase/supabase-js@2'

const getServiceRoleKey = () => {
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) return legacyKey

  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!keys) throw new Error('Falta SUPABASE_SECRET_KEYS')
  return JSON.parse(keys).default
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET')
  if (!cronSecret || request.headers.get('x-reminder-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 })
  }

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')
  if (!token || !chatId) {
    console.error('Faltan los secretos de Telegram')
    return Response.json({ error: 'Telegram no configurado' }, { status: 500 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    getServiceRoleKey(),
    { auth: { persistSession: false } },
  )

  const { data: reminders, error } = await supabase.rpc('claim_due_event_reminders')
  if (error) {
    console.error(error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  const results = await Promise.allSettled((reminders ?? []).map(async (reminder) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reminder.message }),
    })
    if (!response.ok) throw new Error(await response.text())
    const { error: markError } = await supabase.rpc('mark_event_reminder_sent', {
      reminder_uuid: reminder.reminder_id,
    })
    if (markError) throw markError
  }))

  const failed = results.filter((result) => result.status === 'rejected')
  if (failed.length) console.error('Fallaron avisos Telegram', failed)

  return Response.json({ sent: results.length - failed.length, failed: failed.length })
})
