"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
const audio_upload_1 = __importDefault(require("./routes/audio-upload"));
const cors_1 = __importDefault(require("cors"));
const stripe_1 = __importDefault(require("stripe"));
const body_parser_1 = __importDefault(require("body-parser"));
dotenv_1.default.config();
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2023-10-16",
});
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
app.post("/stripe-webhook", body_parser_1.default.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    try {
        event = stripe_1.default.webhooks.constructEvent(req.body, sig, endpointSecret);
    }
    catch (err) {
        console.error("⚠️ Erro ao verificar assinatura do webhook:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const user_id = session.metadata?.user_id;
        if (!user_id) {
            console.warn("user_id ausente na sessão de pagamento.");
            return res.status(400).send("Faltando metadata user_id");
        }
        await supabase
            .from("users")
            .update({
            credits: 1000,
            ia_credits_used: 0,
            out_of_ia_credits: false,
        })
            .eq("id", user_id);
        console.log("✅ Créditos recarregados para user_id:", user_id);
    }
    res.status(200).send("OK");
});
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    origin: "https://turios-ia.vercel.app",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
}));
app.use("/api", audio_upload_1.default);
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const FORWARD_TO_MAKE_URL = process.env.MAKE_WEBHOOK_URL;
app.get('/webhook', (req, res) => {
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
app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry || []) {
                for (const change of entry.changes || []) {
                    const messages = change.value?.messages;
                    if (!messages)
                        continue;
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
                        let user_id = entry.id || null;
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
                        user_id = userRow.user_id;
                        const { error: insertError } = await supabase.from('messages').insert([{
                                from_number: from,
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
                        if (FORWARD_TO_MAKE_URL &&
                            contact?.ai_enabled === true &&
                            !from.startsWith('attendant') &&
                            from !== 'attendant') {
                            try {
                                await axios_1.default.post(FORWARD_TO_MAKE_URL, {
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
                            }
                            catch (err) {
                                console.error('Erro ao reenviar para o Make:', err.message || err);
                            }
                        }
                        else {
                            console.log('IA desativada ou mensagem do atendente — não encaminhada.');
                        }
                    }
                }
            }
            return res.sendStatus(200);
        }
        return res.sendStatus(400);
    }
    catch (err) {
        console.error('Erro no webhook:', err);
        res.sendStatus(500);
    }
});
app.post("/ia-response", async (req, res) => {
    const tokens_usados = Number(req.body.tokens_usados);
    const user_id = String(req.body.user_id);
    const phone = String(req.body.phone);
    if (!tokens_usados || !user_id || !phone) {
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
    await supabase
        .from("contacts")
        .update({ ai_enabled: false })
        .eq("phone", phone)
        .eq("user_id", user_id);
    return res.status(200).json({ success: true });
});
app.post("/create-checkout-session", async (req, res) => {
    const { priceId, user_id } = req.body;
    if (!priceId || !user_id) {
        return res.status(400).json({ error: "priceId e user_id são obrigatórios." });
    }
    try {
        const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: process.env.SUCCESS_URL || "https://turios.com.br/sucesso",
            cancel_url: process.env.CANCEL_URL || "https://turios.com.br/cancelado",
            metadata: { user_id },
        });
        return res.json({ url: session.url });
    }
    catch (err) {
        console.error("Erro ao criar sessão do Stripe:", err.message);
        return res.status(500).json({ error: "Erro ao criar sessão de pagamento." });
    }
});
app.listen(port, () => {
    console.log(`Servidor webhook ativo na porta ${port}`);
});
app.post("/", (req, res) => {
    console.log("POST recebido no /:", req.body);
    res.json({ status: "ok", recebido: true });
});
