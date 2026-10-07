/* VaultSnip: AI providers.
   The only code that talks to an AI service. The browser sends the approved, masked image straight
   to the provider the user picked, with the user's own key. Nothing goes through a VaultSnip server.
   Adding a provider means adding one entry to PROVIDERS. */
(function (global) {
  'use strict';

  const PROVIDERS = {
    anthropic: {
      name: 'Claude (Anthropic)', short: 'Claude', host: 'api.anthropic.com',
      defaultModel: 'claude-sonnet-5-5', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys',
      // Most preferred first: used to pick a default from the models the key can use.
      prefer: [/^claude-sonnet-\d/, /^claude-opus-\d/, /^claude-/],
      looksLike: k => /^sk-ant-/.test(k),
      async models(key) {
        const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: this.headers(key) });
        if (!r.ok) throw await httpError(this, r);
        return ((await r.json()).data || []).map(m => m.id);
      },
      headers: key => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }),
      async ask({ key, model, system, prompt, imageDataUrl }) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: this.headers(key),
          body: JSON.stringify({
            model, max_tokens: 8000, system,
            messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageDataUrl.split(',')[1] } }, { type: 'text', text: prompt }] }]
          })
        });
        if (!r.ok) throw await httpError(this, r);
        const j = await r.json();
        if (j.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing the layout. Try a smaller crop.');
        return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      }
    },
    openai: {
      name: 'OpenAI', short: 'OpenAI', host: 'api.openai.com',
      defaultModel: 'gpt-6-astra', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys',
      prefer: [/^gpt-6-astra$/, /^gpt-6(\.\d+)?-(sol|astra)$/, /^gpt-6/, /^gpt-5\.\d+$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/],
      looksLike: k => /^sk-(?!ant-)/.test(k),
      async models(key) {
        const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: 'Bearer ' + key } });
        if (!r.ok) throw await httpError(this, r);
        return ((await r.json()).data || []).map(m => m.id)
          .filter(id => /^(gpt-|o\d|chatgpt-)/.test(id) && !/audio|realtime|tts|transcribe|image|search|embedding|moderation|instruct|codex/.test(id));
      },
      async ask({ key, model, system, prompt, imageDataUrl }) {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
          body: JSON.stringify({
            model, max_completion_tokens: 16000, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }] }]
          })
        });
        if (!r.ok) throw await httpError(this, r);
        const j = await r.json();
        const c = j.choices && j.choices[0];
        if (c && c.finish_reason === 'length') throw new Error('OpenAI ran out of room before finishing the layout. Try a smaller crop.');
        if (c && c.message && c.message.refusal) throw new Error('OpenAI declined the request: ' + c.message.refusal);
        return (c && c.message && c.message.content) || '';
      }
    }
  };

  async function httpError(p, r) {
    let msg = r.status + ' ' + r.statusText;
    try { const j = await r.json(); msg = (j.error && (j.error.message || j.error.type)) || msg; } catch (e) { /* not JSON */ }
    const e = new Error(
      r.status === 401 ? `${p.short} rejected the key. Check it and try again.` :
      r.status === 403 ? `${p.short} refused this key for that model or feature: ${msg}` :
      r.status === 404 ? `${p.short} does not offer that model to this key. Pick another model from the list.` :
      r.status === 429 ? `${p.short} says the key is over its rate limit or out of credit: ${msg}` :
      `${p.short} request failed: ${msg}`);
    e.status = r.status;
    return e;
  }

  function detect(key) {
    key = String(key || '').trim();
    return Object.keys(PROVIDERS).find(id => PROVIDERS[id].looksLike(key)) || null;
  }
  function pickDefault(provider, ids) {
    const p = PROVIDERS[provider];
    if (ids.includes(p.defaultModel)) return p.defaultModel;
    for (const re of p.prefer) { const hit = ids.filter(id => re.test(id)).sort().reverse().find(id => !/-\d{8}$|preview|mini|nano/.test(id)) || ids.find(id => re.test(id)); if (hit) return hit; }
    return ids[0] || p.defaultModel;
  }
  async function models(provider, key) {
    const ids = await PROVIDERS[provider].models(key);
    return { ids: ids.sort(), suggested: pickDefault(provider, ids) };
  }
  function ask(opts) {
    const p = PROVIDERS[opts.provider];
    if (!p) throw new Error('Unknown AI provider: ' + opts.provider);
    if (!opts.key) throw new Error('Add your ' + p.short + ' API key first.');
    return p.ask(opts);
  }

  global.VSLLM = { PROVIDERS, detect, models, ask, pickDefault };
})(window);
