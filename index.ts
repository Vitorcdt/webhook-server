import express from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { OpenAI } from 'openai'

dotenv.config()

const app = express()
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN!
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID! // 557546570786190
const WHATSAPP_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN!

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge)
  } else {
    return res.sendStatus(403)
  }
})

app.post('/webhook', async (req, res) => {
  const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages || []

  for (const msg of messages) {
    const from = msg.from
    const content = msg.text?.body || '[sem texto]'
    const created_at = new Date().toISOString()

    console.log(`[MSG RECEBIDA] ${from}: ${content}`)

    await supabase.from('messages').insert([{ from, content, created_at }])

    // ➕ Gera resposta com IA
    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Você é um assistente virtual de atendimento para uma empresa SaaS de mensagens.' },
        { role: 'user', content: content }
      ]
    })

    const respostaIA = aiResponse.choices[0].message.content

    console.log(`[IA] ${respostaIA}`)

    // ➕ Envia resposta de volta via WhatsApp API
    await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: from,
        text: { body: respostaIA }
      })
    })
  }

  return res.sendStatus(200)
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Webhook com IA rodando na porta ${PORT}`)
})