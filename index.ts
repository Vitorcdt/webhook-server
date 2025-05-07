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
  const { from, to, content, timestamp } = req.body;

  if (!from || !content) {
    console.log('Rejeitado: corpo inválido', req.body);
    return res.status(400).json({ error: 'Dados inválidos' });
  }

  const dataToInsert = {
    from,
    to: to || 'agent', // fallback padrão
    content,
    from_role: 'client',
    created_at: timestamp
      ? new Date(Number(timestamp)).toISOString()
      : new Date().toISOString() // fallback se timestamp vier vazio
  };

  console.log('[Payload a salvar]', dataToInsert);

  const { error } = await supabase.from('messages').insert([dataToInsert]);

  if (error) {
    console.error('Erro ao salvar mensagem:', error.message);
    return res.status(500).json({ error: error.message });
  }

  res.sendStatus(200);
});


app.listen(port, () => {
  console.log(`Servidor webhook rodando na porta ${port}`);
});
