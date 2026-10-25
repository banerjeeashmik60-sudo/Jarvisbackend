import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const SYSTEM_PROMPT = `You are J.A.R.V.I.S., a polished, concise personal AI assistant inspired by a fictional cinematic assistant. The user's name is Ashmik Banerjee; if asked who created this personal assistant, say it was configured by Ashmik Banerjee. Be truthful about your capabilities: do not claim to control phone hardware, access files, or perform real-world actions unless a connected tool actually enables it. Answer the user's actual question rather than using canned fallback text. Speak naturally, with concise replies suitable for text-to-speech.`;

app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    configured: Boolean(process.env.GROQ_API_KEY),
    voiceConfigured: Boolean(process.env.FISH_API_KEY && process.env.FISH_REFERENCE_ID),
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
  });
});

app.post('/api/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!message) return res.status(400).json({ error: 'Please send a message.' });
  if (message.length > 6000) return res.status(413).json({ error: 'Message is too long.' });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'The AI brain is not configured on the server yet.' });

  // Accept only a small, sanitized slice of recent conversation for context.
  const safeHistory = history.slice(-12).filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...safeHistory, { role: 'user', content: message }],
        temperature: 0.65
      })
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const detail = data?.error?.message || `AI provider returned HTTP ${upstream.status}`;
      return res.status(502).json({ error: detail });
    }
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) return res.status(502).json({ error: 'The AI returned no reply.' });
    res.json({ reply: reply.trim() });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'The AI request timed out. Please try again.' : 'Could not contact the AI provider. Check the server internet connection.';
    res.status(502).json({ error: message });
  }
});

app.post('/api/speak', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'Please provide text to speak.' });
  if (text.length > 2500) return res.status(413).json({ error: 'Speech text is too long.' });
  if (!process.env.FISH_API_KEY || !process.env.FISH_REFERENCE_ID) {
    return res.status(503).json({ error: 'Custom voice is not configured on the server.' });
  }
  try {
    const upstream = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.FISH_API_KEY}`,
        'Content-Type': 'application/json',
        model: process.env.FISH_TTS_MODEL || 's2.1-pro',
        Accept: 'audio/mpeg'
      },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ text, reference_id: process.env.FISH_REFERENCE_ID, format: 'mp3' })
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return res.status(502).json({ error: `Fish Audio returned HTTP ${upstream.status}${detail ? ': ' + detail.slice(0, 240) : ''}` });
    }
    const audio = Buffer.from(await upstream.arrayBuffer());
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'Content-Length': String(audio.length) });
    res.send(audio);
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'Fish Audio voice request timed out.' : 'Could not contact Fish Audio. Check the server internet connection.';
    res.status(502).json({ error: message });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`JARVIS server listening on port ${PORT}`));
