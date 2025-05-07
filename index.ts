import express from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge)
  } else {
    res.sendStatus(403)
  }
})

app.post('/webhook', async (req, res) => {
  const body = req.body

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

  const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages || []

  for (const msg of messages) {
    const from = msg.from
    const content = msg.text?.body || '[sem texto]'
    const created_at = new Date().toISOString()

    await supabase.from('messages').insert([
      { from, content, created_at }
    ])
  }

  res.sendStatus(200)
})

const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`)
})