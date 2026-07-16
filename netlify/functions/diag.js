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

exports.handler = async () => {
  const targets = [
    { hostname: 'api.github.com', path: '/' },
    { hostname: 'generativelanguage.googleapis.com', path: '/' },
    { hostname: 'api.openai.com', path: '/' },
    { hostname: 'www.google.com', path: '/' }
  ];

  const dnsResults = await Promise.all(targets.map((t) => timeDnsLookup(t.hostname)));
  const httpResults = await Promise.all(targets.map((t) => timeHttpsGet(t.hostname, t.path)));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ dns: dnsResults, http: httpResults }, null, 2)
  };
};
