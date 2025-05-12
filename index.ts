
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

app.post("/ia-response", async (req: Request, res: Response) => {
  const { resposta, tokens_usados, user_id, phone } = req.body;

  if (!tokens_usados || !user_id || !phone) {
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

  // Só salva a resposta se ela existir
  if (resposta) {
    await supabase.from("messages").insert([
      {
        from: "agent",
        to: phone,
        content: resposta,
        from_role: "agent",
        user_id,
      },
    ]);
  }

  // Atualiza o uso de tokens
  await supabase
    .from("users")
    .update({ ia_credits_used: ia_credits_used + tokens_usados })
    .eq("id", user_id);

  return res.status(200).json({ success: true });
});

app.listen(port, () => {
  console.log(`Servidor webhook ativo na porta ${port}`);
});
