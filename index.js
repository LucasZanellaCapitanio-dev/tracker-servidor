import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const openai = new OpenAI(); // lê OPENAI_API_KEY das variáveis de ambiente

const MODELO_TEXTO = process.env.MODELO_TEXTO || 'gpt-4o-mini';

const SISTEMA = `Você é o assistente do app Tracker, usado por pessoas com deficiência visual.
Responda em português do Brasil, em frases curtas e claras, só sobre: conectar tags Bluetooth,
botão Tocar, localização de objetos e uso do app. Não use listas, tabelas nem símbolos.`;

// áudios gerados ficam na memória por 10 minutos (id -> Buffer mp3)
const audios = new Map();

async function responder(mensagens) {
  const r = await openai.chat.completions.create({
    model: MODELO_TEXTO,
    messages: [{ role: 'system', content: SISTEMA }, ...mensagens],
  });
  return r.choices[0].message.content;
}

async function gerarVoz(texto) {
  const r = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    input: texto,
    instructions: 'Fale em português do Brasil, devagar e com clareza.',
  });
  const id = crypto.randomUUID();
  audios.set(id, Buffer.from(await r.arrayBuffer()));
  setTimeout(() => audios.delete(id), 10 * 60 * 1000);
  return id;
}

// teste rápido no navegador: abra o endereço do servidor e deve aparecer "ok"
app.get('/', (req, res) => res.send('ok'));

// pergunta por TEXTO (falar: true devolve também o áudio da resposta)
app.post('/ajuda', async (req, res) => {
  try {
    const texto = await responder(req.body.mensagens || []);
    const id = req.body.falar ? await gerarVoz(texto) : null;
    res.json({ texto, audioUrl: id ? `/audio/${id}.mp3` : null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: `Falha na IA: ${e.status || ''} ${e.message}` });
  }
});

// pergunta por VOZ: recebe o áudio, transcreve, responde e devolve texto + áudio
app.post('/voz', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Sem áudio' });
    const t = await openai.audio.transcriptions.create({
      file: await toFile(req.file.buffer, 'voz.m4a'),
      model: 'gpt-4o-mini-transcribe',
      language: 'pt',
    });
    const historico = JSON.parse(req.body.historico || '[]');
    const texto = await responder([...historico, { role: 'user', content: t.text }]);
    const id = await gerarVoz(texto);
    res.json({ pergunta: t.text, texto, audioUrl: `/audio/${id}.mp3` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: `Falha no áudio: ${e.status || ''} ${e.message}` });
  }
});

app.get('/audio/:id.mp3', (req, res) => {
  const buf = audios.get(req.params.id);
  if (!buf) return res.sendStatus(404);
  res.type('audio/mpeg').send(buf);
});

// o Render define a porta sozinho (PORT); no PC usa 3000
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Servidor no ar'));
