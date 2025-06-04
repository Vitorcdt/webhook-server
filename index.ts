
import express, { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import axios from 'axios';
import audioUploadRouter from "./routes/audio-upload";
import stripeRouter from "./routes/stripe";
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
  app.use("/api", stripeRouter);

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

const result = await supabase.from('messages').insert([
  {
    from,
    to,
    content,
    from_role: 'client',
    user_id
  }
]);

console.log("🧾 Resultado do insert:", result);


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

app.post('/chat', async (req: Request, res: Response) => {
  const { agent_id, phone, message } = req.body;

  if (!agent_id || !phone || !message) {
    return res.status(400).json({ error: 'agent_id, phone e message são obrigatórios' });
  }

  // 🛑 Ignorar mensagens disparadas pelo atendente (para evitar loop)
  if (phone.startsWith("attendant") || phone === "attendant") {
    console.log("⚠️ Ignorando mensagem do atendente.");
    return res.sendStatus(200);
  }

  try {
    // 1. Buscar prompt e user_id do agente
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .select('prompt, user_id')
      .eq('id', agent_id)
      .single();

    if (agentError || !agentData?.prompt) {
      return res.status(404).json({ error: 'Agente IA não encontrado ou sem prompt' });
    }

    // 2. Buscar dados de créditos do usuário
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('credits, ia_credits_used')
      .eq('id', agentData.user_id)
      .single();

    if (userError || !userData) {
      return res.status(500).json({ error: 'Usuário não encontrado' });
    }

    // 3. Buscar histórico de mensagens
    const { data: history, error: historyError } = await supabase
      .from('messages')
      .select('content, from_role, created_at')
      .eq('to', phone)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true })
      .limit(10);

    if (historyError) {
      console.error('Erro ao buscar mensagens:', historyError);
      return res.status(500).json({ error: 'Erro ao buscar histórico' });
    }

    const systemPrompt = {
      role: 'system',
      content: agentData.prompt
    };

    const chatHistory = history.map(msg => ({
      role: msg.from_role === 'client' ? 'user' : 'assistant',
      content: msg.content
    }));

    const messages = [
      systemPrompt,
      ...chatHistory,
      { role: 'user', content: message }
    ];

    // 4. Chamada à OpenAI protegida com try interno
    let reply: string = "";
    let tokensUsados: number = 0;

    try {
      const gptResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages,
          temperature: 0.7
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      reply = gptResponse.data.choices?.[0]?.message?.content?.trim() || "";
      tokensUsados = gptResponse.data.usage?.total_tokens || 0;

    } catch (error: any) {
      console.error("❌ Erro ao chamar OpenAI:", error.response?.data || error.message);
      return res.status(500).json({ error: "Erro ao gerar resposta com IA" });
    }

    // 5. Verificação de resposta nula ou vazia
    if (!reply || reply.length < 2) {
      console.warn("⚠️ Resposta da IA vazia ou inválida.");
      return res.status(500).json({ error: "Resposta da IA vazia." });
    }

    // 6. Verificar créditos
    if ((userData.ia_credits_used + tokensUsados) > userData.credits) {
      await supabase
        .from("users")
        .update({ out_of_ia_credits: true })
        .eq("id", agentData.user_id);

      return res.status(403).json({ error: "Créditos de IA insuficientes." });
    }

    // 7. Atualizar uso de créditos
    await supabase
      .from("users")
      .update({
        ia_credits_used: userData.ia_credits_used + tokensUsados
      })
      .eq("id", agentData.user_id);

    // 8. Salvar resposta no Supabase
    await supabase.from("messages").insert([
      {
        from: "agent",
        to: phone,
        content: reply,
        from_role: "agent",
        user_id: agentData.user_id,
        is_ai: true
      }
    ]);

    // 9. Retornar resposta
    return res.status(200).json({
      response: reply,
      tokens: tokensUsados
    });

  } catch (err) {
    console.error('Erro geral no /chat:', err);
    return res.status(500).json({ error: 'Erro interno ao gerar resposta' });
  }
});

// ⬇️ Por último
app.listen(port, () => {
  console.log(`Servidor webhook ativo na porta ${port}`);
});
