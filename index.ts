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

const FORWARD_TO_MAKE_URL = process.env.MAKE_WEBHOOK_URL;

app.get('/webhook', (req: Request, res: Response) => {
  const VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado com sucesso!');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post('/webhook', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Webhook da Meta
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const messages = change.value?.messages;
          if (!messages) continue;

          for (const msg of messages) {
            const from = msg.from;
            const to = change.value.metadata.phone_number_id;

            if (from === to) {
              console.log("Ignorando mensagem enviada pelo número oficial (IA/Agente)");
              continue;
            }

            const content = msg.text?.body || '[sem texto]';
            const rawTs = Number(msg.timestamp);
            const timestamp = new Date(rawTs > 1e12 ? rawTs : rawTs * 1000).toISOString();
            const msgId = msg.id;

            console.log('[Nova mensagem recebida]', { from, to, content, timestamp });

            const { data: userRow } = await supabase
              .from('whatsapp_accounts')
              .select('user_id')
              .eq('phone_number_id', to)
              .maybeSingle();

            if (!userRow) {
              console.warn('user_id não encontrado para o número:', to);
              continue;
            }

            const user_id = userRow.user_id;

            await supabase.from('messages').insert([{
              from,
              to,
              content,
              created_at: timestamp,
              from_role: 'client',
              user_id,
              meta_msg_id: msgId
            }]);

            await supabase.from('contacts').upsert([{
              phone: from,
              name: `Cliente ${from}`,
              user_id,
              created_at: new Date().toISOString()
            }], {
              onConflict: 'phone, user_id'
            });

            // Busca name e photo_url para enviar ao Make
            const { data: contact } = await supabase
              .from('contacts')
              .select('name, photo_url')
              .eq('phone', from)
              .eq('user_id', user_id)
              .maybeSingle();

            const contactName = contact?.name || `Cliente ${from}`;
            const contactPhoto = contact?.photo_url || null;

            if (FORWARD_TO_MAKE_URL) {
              try {
                await axios.post(FORWARD_TO_MAKE_URL, {
                  from,
                  to,
                  content,
                  timestamp,
                  msgId,
                  user_id,
                  name: contactName,
                  photo_url: contactPhoto
                });
                console.log('Mensagem encaminhada para o Make');
              } catch (err) {
                console.error('Erro ao reenviar para o Make:', err);
              }
            }
          }
        }
      }

      return res.sendStatus(200);
    }

    // Suporte a mensagens manuais via Make
    else if (body.from && body.content && body.user_id) {
      const { from, to, content, timestamp, user_id } = body;
      const tsNum = Number(timestamp);
      const safeTimestamp = new Date(tsNum > 1e12 ? tsNum : tsNum * 1000).toISOString();

      await supabase.from('messages').insert([{
        from,
        to,
        content,
        created_at: safeTimestamp,
        from_role: 'client',
        user_id
      }]);

      await supabase.from('contacts').upsert([{
        phone: from,
        name: `Cliente ${from}`,
        user_id,
        created_at: new Date().toISOString()
      }], {
        onConflict: 'phone, user_id'
      });

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
