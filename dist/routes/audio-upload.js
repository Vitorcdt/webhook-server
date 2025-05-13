"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const ffmpeg_1 = __importDefault(require("@ffmpeg-installer/ffmpeg"));
const supabase_js_1 = require("@supabase/supabase-js");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({ dest: "uploads/" });
fluent_ffmpeg_1.default.setFfmpegPath(ffmpeg_1.default.path);
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
router.post("/audio-upload", upload.single("audio"), async (req, res) => {
    const file = req.file;
    if (!file)
        return res.status(400).send("Nenhum arquivo enviado.");
    const oggPath = `uploads/${Date.now()}-audio.ogg`;
    try {
        await new Promise((resolve, reject) => {
            (0, fluent_ffmpeg_1.default)(file.path)
                .toFormat("ogg")
                .audioCodec("libopus")
                .on("end", () => resolve())
                .on("error", (err) => reject(err))
                .save(oggPath);
        });
        const buffer = fs_1.default.readFileSync(oggPath);
        const fileName = `audios/${Date.now()}-audio.ogg`;
        const { error: uploadError } = await supabase.storage
            .from("message-files")
            .upload(fileName, buffer, {
            contentType: "audio/ogg",
            upsert: true,
        });
        if (uploadError)
            throw uploadError;
        const { publicUrl } = supabase.storage
            .from("message-files")
            .getPublicUrl(fileName).data;
        fs_1.default.unlinkSync(file.path);
        fs_1.default.unlinkSync(oggPath);
        return res.json({ url: publicUrl });
    }
    catch (err) {
        console.error("Erro ao converter áudio:", err);
        return res.status(500).send("Erro ao processar áudio.");
    }
});
exports.default = router;
