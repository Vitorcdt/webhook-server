import express, { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

app.get('/webhook', (req: Request, res: Response) => {
  const VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado com sucesso!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const messages = change.value?.messages;
          if (!messages) continue;

          for (const msg of messages) {
            const from = msg.from;
            const to = change.value.metadata.phone_number_id;
            const content = msg.text?.body || '[sem texto]';
            const timestamp = new Date(Number(msg.timestamp) * 1000).toISOString();

            console.log('[Nova mensagem recebida]', { from, to, content, timestamp });

            const { error } = await supabase.from('messages').insert([
              {
                from,
                to,
                content,
                created_at: timestamp,
                from_role: 'client',
              },
            ]);

            if (error) {
              console.error('Erro ao salvar no Supabase:', error.message);
            }
          }
        }
      }

      return res.sendStatus(200);
    } else if (body.from && body.content) {
      // Lógica alternativa direta
      const { from, to, content, timestamp } = body;

      const { error } = await supabase.from('messages').insert([
        {
          from,
          to,
          content,
          created_at: new Date(Number(timestamp) * 1000).toISOString(),
          from_role: 'client'
        }
      ]);

      if (error) {
        console.error('Erro ao salvar mensagem (Make):', error.message);
        return res.status(500).json({ error: 'Erro ao salvar mensagem' });
      }

      return res.sendStatus(200);
    } else {
      return res.sendStatus(400);
    }

  } catch (err) {
    console.error('Erro no webhook:', err);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`Servidor webhook ativo na porta ${port}`);
});