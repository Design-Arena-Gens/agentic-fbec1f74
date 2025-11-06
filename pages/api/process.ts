import type { NextApiRequest, NextApiResponse } from 'next';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type InputBody = {
  type: 'text' | 'voice' | 'link';
  text?: string;
  voiceUrl?: string;
  link?: string;
  postToBlogger?: boolean;
};

async function fetchTextFromLink(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Falha ao buscar link: ${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (article?.textContent && article.textContent.trim().length > 0) {
    return article.textContent.trim();
  }
  const text = dom.window.document.body.textContent || '';
  return text.trim();
}

async function transcribeFromUrl(voiceUrl: string): Promise<string> {
  const res = await fetch(voiceUrl);
  if (!res.ok) throw new Error(`Falha ao baixar ?udio: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  // Node 18+ has global File/Blob via undici
  const file = new File([buffer], 'audio', { type: 'application/octet-stream' });
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'pt',
  } as any);
  // Types in SDK can be behind; cast to any
  const text = (transcription as any).text as string;
  return text;
}

async function summarizeFinancePortuguese(input: string): Promise<{ title: string; summaryHtml: string }>{
  const prompt = `Voc? ? um redator financeiro em PT-BR. Receba o conte?do a seguir (pode ser transcri??o de voz, texto bruto ou not?cia) e produza:
- Um t?tulo curto e chamativo (<= 70 caracteres)
- Um resumo estruturado e objetivo, com subt?tulos quando fizer sentido
- Tom profissional, educativo, sem jarg?es excessivos
- Inclua 3 a 5 bullet points de insights pr?ticos

Retorne APENAS um JSON com as chaves: title, html. N?o inclua c?digo, markdown ou explica??es.

CONTE?DO:
"""
${input}
"""`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.5,
    messages: [
      { role: 'system', content: 'Voc? escreve resumos para um blog financeiro brasileiro.' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' } as any,
  });
  const content = completion.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);
  return { title: parsed.title, summaryHtml: parsed.html };
}

async function generateImageBase64(prompt: string): Promise<string> {
  const res = await openai.images.generate({
    model: 'gpt-image-1',
    prompt: `Ilustra??o editorial minimalista e limpa sobre finan?as: ${prompt}. Estilo moderno, cores s?brias, sem texto.`,
    size: '1024x1024',
    quality: 'hd',
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error('Falha ao gerar imagem');
  return `data:image/png;base64,${b64}`;
}

async function ensureGoogleAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Vari?veis GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN ausentes');
  }
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('refresh_token', refreshToken);
  params.set('grant_type', 'refresh_token');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OAuth error: ${json.error || res.status}`);
  return json.access_token as string;
}

async function postToBlogger(title: string, html: string): Promise<{ url?: string; id?: string }>{
  const blogId = process.env.BLOGGER_BLOG_ID;
  if (!blogId) throw new Error('BLOGGER_BLOG_ID ausente');
  const accessToken = await ensureGoogleAccessToken();

  const endpoint = `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/?isDraft=false&fetchImages=true&revert=false`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'blogger#post',
      title,
      content: html,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Blogger error: ${data?.error?.message || res.status}`);
  }
  return { url: data.url, id: data.id };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body: InputBody = req.body;
    if (!body || !body.type) return res.status(400).json({ error: 'Par?metros inv?lidos' });

    let sourceText = '';
    if (body.type === 'text') {
      if (!body.text) return res.status(400).json({ error: 'Texto ausente' });
      sourceText = body.text;
    } else if (body.type === 'link') {
      if (!body.link) return res.status(400).json({ error: 'Link ausente' });
      sourceText = await fetchTextFromLink(body.link);
    } else if (body.type === 'voice') {
      if (!body.voiceUrl) return res.status(400).json({ error: 'voiceUrl ausente' });
      sourceText = await transcribeFromUrl(body.voiceUrl);
    }

    const { title, summaryHtml } = await summarizeFinancePortuguese(sourceText);
    const imageDataUrl = await generateImageBase64(title);

    const html = `
      <div style="text-align:center;margin:0 0 16px 0">
        <img src="${imageDataUrl}" alt="${title}" style="max-width:100%;height:auto" />
      </div>
      ${summaryHtml}
    `;

    let bloggerPostUrl: string | undefined;
    if (body.postToBlogger) {
      const post = await postToBlogger(title, html);
      bloggerPostUrl = post.url;
    }

    return res.status(200).json({ title, html, imageDataUrl, bloggerPostUrl });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
