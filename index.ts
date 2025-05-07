import express from 'express'
import type { Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN!

app.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge)
  }

  return res.sendStatus(403)
})

app.post('/webhook', async (req: Request, res: Response) => {
  const body = req.body

  // Formato simplificado (Make)
  if (body?.from && body?.content) {
    await supabase.from('messages').insert([
      {
        from: body.from,
        content: body.content,
        created_at: new Date().toISOString()
      }
    ])
    return res.sendStatus(200)
  }

  // Formato oficial (Meta)
  const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages || []

  for (const msg of messages) {
    const from = msg.from
    const content = msg.text?.body || '[sem texto]'
    const created_at = new Date().toISOString()

    await supabase.from('messages').insert([
      { from, content, created_at }
    ])
  }

  return res.sendStatus(200)
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`)
})