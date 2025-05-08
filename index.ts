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

app.post('/webhook', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(400);
    }

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

          const { error: insertError } = await supabase.from('messages').insert([
            {
              from,
              to,
              content,
              created_at: timestamp,
              from_role: 'client',
              user_id,
              meta_msg_id: msgId
            }
          ]);

          if (insertError) {
            console.error('Erro ao salvar mensagem:', insertError.message);
          }

          await supabase.from('contacts').upsert([
            {
              phone: from,
              name: "Contato - 08/05/2025",
              user_id
            }
          ], {
            onConflict: 'phone, user_id',
            ignoreDuplicates: true
          });

          if (FORWARD_TO_MAKE_URL) {
            try {
              await axios.post(FORWARD_TO_MAKE_URL, {
                from,
                to,
                content,
                timestamp,
                msgId,
                user_id
              });
              console.log('Mensagem encaminhada para o Make');
            } catch (err) {
              console.error('Erro ao reenviar para o Make:', err);
            }
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`Servidor webhook ativo na porta ${port}`);
});