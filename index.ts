import express, { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import axios from 'axios';

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
          const statuses = change.value?.statuses;

          // Mensagens recebidas
          if (messages) {
            for (const msg of messages) {
              const from = msg.from;
              const to = change.value.metadata.phone_number_id;
              const content = msg.text?.body || '[sem texto]';
              const timestamp = new Date(Number(msg.timestamp) * 1000).toISOString();
              const msgId = msg.id;

              console.log('[Nova mensagem recebida]', { from, to, content, timestamp });

              // Busca o user_id pelo número do contato
              const { data: contactMatch } = await supabase
                .from('contacts')
                .select('user_id')
                .eq('phone', from)
                .single();

              const user_id = contactMatch?.user_id || null;

              const { error } = await supabase.from('messages').insert([
                {
                  from,
                  to,
                  content,
                  created_at: timestamp,
                  from_role: 'client',
                  meta_msg_id: msgId,
                  user_id,
                },
              ]);

              if (error) {
                console.error('Erro ao salvar no Supabase:', error.message);
              }
            }
          }
          // Atualização de status (ex: "read")
          if (statuses) {
            for (const status of statuses) {
              const msgId = status.id;
              const statusType = status.status; // ex: 'read', 'delivered', etc.

              if (statusType === 'read') {
                const { error: updateError } = await supabase
                  .from('messages')
                  .update({ status: 'lido' })
                  .eq('meta_msg_id', msgId);

                if (updateError) {
                  console.error('Erro ao atualizar status para lido:', updateError.message);
                } else {
                  console.log(`Mensagem ${msgId} marcada como lida.`);
                }
              }
            }
          }
        }
      }

      return res.sendStatus(200);
    }

    return res.sendStatus(400);
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`Servidor webhook ativo na porta ${port}`);
});