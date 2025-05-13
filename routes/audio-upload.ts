
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

router.post("/audio-upload", upload.single("audio"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send("Nenhum arquivo enviado.");

  const oggPath = `uploads/${Date.now()}-audio.ogg`;

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(file.path)
        .toFormat("ogg")
        .audioCodec("libopus")
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .save(oggPath);
    });

    const buffer = fs.readFileSync(oggPath);
    const fileName = `audios/${Date.now()}-audio.ogg`;

    const { error: uploadError } = await supabase.storage
      .from("message-files")
      .upload(fileName, buffer, {
        contentType: "audio/ogg",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { publicUrl } = supabase.storage
      .from("message-files")
      .getPublicUrl(fileName).data;

    fs.unlinkSync(file.path);
    fs.unlinkSync(oggPath);

    return res.json({ url: publicUrl });
  } catch (err) {
    console.error("Erro ao converter áudio:", err);
    return res.status(500).send("Erro ao processar áudio.");
  }
});

export default router;
