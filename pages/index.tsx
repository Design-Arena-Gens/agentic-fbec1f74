import { useState } from 'react';

export default function Home() {
  const [inputType, setInputType] = useState<'text' | 'voice' | 'link'>('text');
  const [text, setText] = useState('');
  const [voiceUrl, setVoiceUrl] = useState('');
  const [link, setLink] = useState('');
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    setError(null);
    setResult(null);

    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: inputType,
        text: inputType === 'text' ? text : undefined,
        voiceUrl: inputType === 'voice' ? voiceUrl : undefined,
        link: inputType === 'link' ? link : undefined,
        postToBlogger: true,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setPosting(false);
      setError(body.error || 'Erro ao processar.');
      return;
    }

    const data = await res.json();
    setPosting(false);
    setResult(data);
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1>Automa??o Blog Financeiro (n8n helper)</h1>
      <p>Teste local de processamento e publica??o no Blogger.</p>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <label>
          Tipo de entrada:
          <select value={inputType} onChange={e => setInputType(e.target.value as any)}>
            <option value="text">Texto</option>
            <option value="voice">Voz (URL do arquivo)</option>
            <option value="link">Link</option>
          </select>
        </label>

        {inputType === 'text' && (
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8} placeholder="Cole o texto aqui" />
        )}

        {inputType === 'voice' && (
          <input value={voiceUrl} onChange={e => setVoiceUrl(e.target.value)} placeholder="URL do arquivo de ?udio (ogg, mp3, m4a)" />
        )}

        {inputType === 'link' && (
          <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://..." />
        )}

        <button disabled={posting} type="submit">
          {posting ? 'Processando...' : 'Processar e Publicar'}
        </button>
      </form>

      {error && (
        <div style={{ color: 'red', marginTop: 16 }}>Erro: {error}</div>
      )}

      {result && (
        <div style={{ marginTop: 24 }}>
          <h2>Resultado</h2>
          <div>
            <strong>T?tulo:</strong> {result.title}
          </div>
          <div style={{ margin: '12px 0' }}>
            {result.imageDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.imageDataUrl} alt="imagem" style={{ maxWidth: '100%' }} />
            )}
          </div>
          <div dangerouslySetInnerHTML={{ __html: result.html }} />
          {result.bloggerPostUrl && (
            <p>
              Publicado: <a href={result.bloggerPostUrl} target="_blank" rel="noreferrer">{result.bloggerPostUrl}</a>
            </p>
          )}
        </div>
      )}

      <hr style={{ margin: '32px 0' }} />
      <section>
        <h3>Configura??o via Vari?veis de Ambiente</h3>
        <ul>
          <li>OPENAI_API_KEY</li>
          <li>GOOGLE_CLIENT_ID</li>
          <li>GOOGLE_CLIENT_SECRET</li>
          <li>GOOGLE_REFRESH_TOKEN</li>
          <li>BLOGGER_BLOG_ID</li>
        </ul>
      </section>
    </div>
  );
}
