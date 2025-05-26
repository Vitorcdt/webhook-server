
import express, { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import axios from 'axios';
import audioUploadRouter from "./routes/audio-upload";
import cors from "cors";

dotenv.config();

const app = express();
 const port = process.env.PORT || 3000;
 app.use(express.json());
 app.use(cors({
   origin: "https://turios-ia.vercel.app",
   methods: ["GET", "POST"],
   allowedHeaders: ["Content-Type"],
 }));
  app.use("/api", audioUploadRouter);


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

  const { data: userRow, error: userError } = await supabase
    .from('whatsapp_accounts')
    .select('user_id')
    .eq('phone_number_id', to)
    .maybeSingle();

  if (userError) {
    console.error('❌ Erro ao buscar user_id:', userError.message);
    continue;
  }

  if (!userRow) {
    console.warn('⚠️ user_id não encontrado para o número:', to);
    continue;
  }

  const user_id = userRow.user_id;
  console.log("📥 Tentando salvar mensagem no Supabase...");

const { error: insertError } = await supabase.from('messages').insert([
  {
    from,
    to,
    content,
    created_at: timestamp,
    from_role: 'client',
    user_id
  }
]);

if (insertError) {
  console.error('❌ Erro ao salvar mensagem:', insertError.message);
} else {
  console.log('✅ Mensagem do cliente salva com sucesso no Supabase.');
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
      console.log('➡️ Mensagem encaminhada para o Make');
    } catch (err: any) {
      console.error('❌ Erro ao reenviar para o Make:', err.message || err);
    }
  } else {
    console.log('ℹ️ IA desativada ou mensagem do atendente — não encaminhada.');
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

// Adicionando o endpoint /ia-response de forma segura
app.post("/ia-response", async (req: Request, res: Response) => {
  const tokens_usados = Number(req.body.tokens_usados);
  const user_id = String(req.body.user_id);
  const phone = String(req.body.phone);
  const mensagemIA = String(req.body.resposta);

  if (!tokens_usados || !user_id || !phone || !mensagemIA) {
    console.log('[IA-RESPONSE] Dados incompletos recebidos:', { tokens_usados, user_id, phone });
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

  await supabase
    .from("users")
    .update({ ia_credits_used: ia_credits_used + tokens_usados })
    .eq("id", user_id);

  // SALVA A MENSAGEM DA IA
  await supabase.from("messages").insert([
    {
      from: "agent",
      to: phone,
      content: mensagemIA,
      from_role: "agent",
      user_id,
      is_ai: true
    }
  ]);

  return res.status(200).json({ success: true });
});


app.listen(port, () => {
  console.log(`Servidor webhook ativo na porta ${port}`);
});
