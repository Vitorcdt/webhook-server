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

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const messages = change.value?.messages;
          if (!messages) continue;

          for (const msg of messages) {
            const from = msg.from;
            const to = change.value.metadata.phone_number_id;

            if (from === to) {
              console.log("Ignorando mensagem do número oficial");
              continue;
            }

            const content = msg.text?.body || '[sem texto]';
            const timestamp = new Date(Number(msg.timestamp) * 1000 - 3 * 60 * 60 * 1000).toISOString();
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

            const { error: insertError } = await supabase.from('messages').insert([{
              from,
              to,
              content,
              created_at: timestamp,
              from_role: 'client',
              user_id,
              meta_msg_id: msgId
            }]);

            if (insertError) {
              console.error('Erro ao salvar mensagem:', insertError.message);
            }

            await supabase.from('contacts').upsert([{
              phone: from,
              name: `Cliente ${from}`,
              user_id
            }], {
              onConflict: 'phone, user_id',
              ignoreDuplicates: true
            });

            const { data: contact } = await supabase
              .from('contacts')
              .select('name, photo_url, ai_enabled')
              .eq('phone', from)
              .eq('user_id', user_id)
              .maybeSingle();

            if (
              FORWARD_TO_MAKE_URL &&
              contact?.ai_enabled === true &&
              !from.startsWith('attendant') &&
              from !== 'attendant'
            ) {
              try {
                await axios.post(FORWARD_TO_MAKE_URL, {
                  from,
                  to,
                  content,
                  timestamp,
                  msgId,
                  user_id,
                  name: contact.name || `Cliente ${from}`,
                  photo_url: contact.photo_url || null
                });
                console.log('Mensagem encaminhada para o Make');
              } catch (err: any) {
                console.error('Erro ao reenviar para o Make:', err.message || err);
              }
            } else {
              console.log('IA desativada ou mensagem do atendente — não encaminhada.');
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


app.post("/ia-response", async (req: Request, res: Response) => {
  const { resposta, tokens_usados, user_id, phone } = req.body;

  if (!resposta || !tokens_usados || !user_id || !phone) {
    return res.status(400).json({ error: "Dados incompletos." });
  }

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("credits, ia_credits_used")
    .eq("id", user_id)
    .single();

  if (userError || !userData) {
    return res.status(500).json({ error: "Usuário não encontrado." });
  }

  const { credits, ia_credits_used } = userData;

  if (ia_credits_used + tokens_usados > credits) {
    await supabase
      .from("users")
      .update({ out_of_ia_credits: true })
      .eq("id", user_id);

    return res.status(403).json({ error: "Créditos de IA insuficientes." });
  }

  const { error: insertError } = await supabase.from("messages").insert([
    {
      from: "agent",
      to: phone,
      content: resposta,
      from_role: "agent",
      user_id,
    },
  ]);

  if (insertError) {
    return res.status(500).json({ error: "Erro ao salvar mensagem." });
  }

  await supabase
    .from("users")
    .update({ ia_credits_used: ia_credits_used + tokens_usados })
    .eq("id", user_id);

  return res.status(200).json({ success: true });
});
