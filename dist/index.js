"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN;
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('[Webhook] Verificado com sucesso');
        return res.status(200).send(challenge);
    }
    else {
        return res.sendStatus(403);
    }
});
app.post('/webhook', async (req, res) => {
    const body = req.body;
    // Suporte ao formato simplificado (Make)
    if (body?.from && body?.content) {
        await supabase.from('messages').insert([{
                from: body.from,
                content: body.content,
                created_at: new Date().toISOString()
            }]);
        return res.sendStatus(200);
    }
    // Formato oficial do WhatsApp Cloud API
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages || [];
    for (const msg of messages) {
        const from = msg.from;
        const content = msg.text?.body || '[sem texto]';
        const created_at = new Date().toISOString();
        await supabase.from('messages').insert([{ from, content, created_at }]);
    }
    return res.sendStatus(200);
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor webhook rodando na porta ${PORT}`);
});
