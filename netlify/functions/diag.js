const https = require('https');
const dns = require('dns');

function timeDnsLookup(hostname, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ hostname, ok: false, ms: Date.now() - started, error: `dns lookup timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        resolve({ hostname, ok: false, ms: Date.now() - started, error: err.message });
      } else {
        resolve({ hostname, ok: true, ms: Date.now() - started, addresses });
      }
    });
  });
}

function timeHttpsGet(hostname, path, timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const options = { hostname, path, method: 'GET', family: 4, headers: { 'User-Agent': 'diag-check' } };

    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ hostname, ok: true, ms: Date.now() - started, statusCode: res.statusCode });
      });
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolve({ hostname, ok: false, ms: Date.now() - started, error: `https request timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    req.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ hostname, ok: false, ms: Date.now() - started, error: e.message });
    });
    req.end();
  });
}

function timeGeminiCall(modelName, apiKey, timeoutMs = 20000) {
  const started = Date.now();
  const payload = { contents: [{ parts: [{ text: 'Say hi in one word.' }] }] };
  return new Promise((resolve) => {
    let settled = false;
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      method: 'POST',
      family: 4,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const data = Buffer.concat(chunks).toString('utf-8');
        resolve({ modelName, ok: res.statusCode >= 200 && res.statusCode < 300, ms: Date.now() - started, statusCode: res.statusCode, bodySample: data.slice(0, 300) });
      });
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolve({ modelName, ok: false, ms: Date.now() - started, error: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    req.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ modelName, ok: false, ms: Date.now() - started, error: e.message });
    });
    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function timeGeminiCallViaFetch(modelName, apiKey, timeoutMs = 20000) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Say hi in one word.' }] }] }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const text = await res.text();
    return { modelName, ok: res.ok, ms: Date.now() - started, statusCode: res.status, bodySample: text.slice(0, 300) };
  } catch (e) {
    clearTimeout(timer);
    return { modelName, ok: false, ms: Date.now() - started, error: e.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : e.message };
  }
}

exports.handler = async () => {
  const targets = [
    { hostname: 'api.github.com', path: '/' },
    { hostname: 'generativelanguage.googleapis.com', path: '/' },
    { hostname: 'api.openai.com', path: '/' },
    { hostname: 'www.google.com', path: '/' }
  ];

  const dnsResults = await Promise.all(targets.map((t) => timeDnsLookup(t.hostname)));
  const httpResults = await Promise.all(targets.map((t) => timeHttpsGet(t.hostname, t.path)));

  const apiKey = process.env.GEMINI_API_KEY;
  const keyInfo = apiKey ? { present: true, length: apiKey.length, hasSurroundingWhitespace: apiKey.trim().length !== apiKey.length, startsWith: apiKey.slice(0, 6), endsWith: apiKey.slice(-4) } : { present: false };

  const [flashResult, flashLiteResult] = apiKey
    ? await Promise.all([timeGeminiCall('gemini-3.5-flash', apiKey), timeGeminiCall('gemini-3.1-flash-lite', apiKey)])
    : [{ skipped: 'no GEMINI_API_KEY in env' }, { skipped: 'no GEMINI_API_KEY in env' }];

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ dns: dnsResults, http: httpResults, geminiKeyInfo: keyInfo, geminiFlash: flashResult, geminiFlashLite: flashLiteResult }, null, 2)
  };
};
