import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// A Groq usa o mesmo formato da OpenAI, só muda o endereço e a chave (plano gratuito).
const ia = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const MODELO_TEXTO = process.env.MODELO_TEXTO || 'openai/gpt-oss-120b';
const MODELO_VOZ = process.env.MODELO_VOZ || 'whisper-large-v3-turbo';

const SISTEMA = `Você é o assistente do app Tracker, usado por pessoas com deficiência visual.
O app conecta tags Bluetooth, tem o botão Tocar e ajuda a localizar objetos e cômodos.
Responda em português do Brasil, em frases curtas e claras, sem listas, tabelas nem símbolos.
Ajude com o uso do app. Se a pessoa pedir algo simples fora do app, como uma conta ou uma dúvida rápida, responda normalmente.`;

async function responder(mensagens) {
  const r = await ia.chat.completions.create({
    model: MODELO_TEXTO,
    messages: [{ role: 'system', content: SISTEMA }, ...mensagens],
  });
  return r.choices[0].message.content;
}

// teste rápido no navegador: abra o endereço do servidor e deve aparecer "ok"
app.get('/', (req, res) => res.send('ok'));

// pergunta por TEXTO
app.post('/ajuda', async (req, res) => {
  try {
    const texto = await responder(req.body.mensagens || []);
    res.json({ texto });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: `Falha na IA: ${e.status || ''} ${e.message}` });
  }
});

// frases que o Whisper costuma "inventar" quando o áudio é silêncio ou só ruído
const ALUCINACOES = ['música', 'musica', 'obrigado', 'obrigada', 'tchau', 'legendas', 'amara.org'];

// pergunta por VOZ: transcreve o áudio e responde (o celular fala a resposta)
app.post('/voz', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Sem áudio' });
    console.log('Áudio recebido:', req.file.size, 'bytes', req.file.mimetype);
    if (req.file.size < 4000) {
      return res.json({ pergunta: '', texto: 'O áudio ficou muito curto. Toque no microfone, fale e toque de novo.' });
    }
    const t = await ia.audio.transcriptions.create({
      file: await toFile(req.file.buffer, 'voz.m4a', { type: 'audio/m4a' }),
      model: MODELO_VOZ,
      language: 'pt',
      temperature: 0,
      prompt: 'Conversa em português do Brasil com o assistente do app Tracker, sobre tags Bluetooth e o botão Tocar.',
    });
    const ouvido = (t.text || '').trim();
    console.log('Transcrição:', ouvido);
    const limpo = ouvido.toLowerCase().replace(/[^a-zà-ú.\s]/g, '').trim();
    if (limpo.length < 2 || ALUCINACOES.includes(limpo)) {
      return res.json({ pergunta: ouvido, texto: 'Não consegui ouvir direito. Fale mais perto do microfone e tente de novo.' });
    }
    const historico = JSON.parse(req.body.historico || '[]');
    const texto = await responder([...historico, { role: 'user', content: ouvido }]);
    res.json({ pergunta: ouvido, texto });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: `Falha no áudio: ${e.status || ''} ${e.message}` });
  }
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Servidor no ar'));
