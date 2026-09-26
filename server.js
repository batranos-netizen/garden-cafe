// ============================================================
//  Garden Café · Sistema de pedidos por QR + Mercado Pago
//  Carta web -> Bot de pedido -> Pago MP -> Verificación -> Cocina
// ============================================================
// Sin dependencias externas: solo Node.js 18+
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Carga simple de .env (si existe)
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    for (const linea of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';
const MP_API = (process.env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/$/, '');
const MP_MOCK = process.env.MP_MOCK === '1' || !MP_ACCESS_TOKEN; // modo prueba sin Mercado Pago real
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'garden1234';
const CANT_MESAS = parseInt(process.env.CANT_MESAS || '12', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(PANEL_PASSWORD + 'garden').digest('hex');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const ORDERS_FILE = path.join(DATA_DIR, 'pedidos.json');

// ---------- Carta ----------
const MENU_FILE = path.join(__dirname, 'menu.json');
function loadMenu() { return JSON.parse(fs.readFileSync(MENU_FILE, 'utf8')); }

// ---------- Almacenamiento simple (archivo JSON) ----------
let db = { pedidos: {}, contador: { fecha: '', numero: 0 }, pagosProcesados: {} };
try { if (fs.existsSync(ORDERS_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')) }; } catch (e) { console.error('No se pudo leer pedidos.json', e); }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(ORDERS_FILE + '.tmp', JSON.stringify(db, null, 2), (err) => {
      if (!err) fs.rename(ORDERS_FILE + '.tmp', ORDERS_FILE, () => {});
    });
  }, 200);
}
function hoyAR() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
}
function siguienteNumero() {
  const hoy = hoyAR();
  if (db.contador.fecha !== hoy) db.contador = { fecha: hoy, numero: 0 };
  db.contador.numero += 1;
  return db.contador.numero;
}
const fmt = (n) => '$' + Math.round(n).toLocaleString('es-AR');

// ---------- App ----------
// ---------- Mini servidor HTTP (compatible con estilo Express) ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const rutas = [];
const app = {
  get: (p, ...h) => rutas.push({ m: 'GET', ...compilar(p), h }),
  post: (p, ...h) => rutas.push({ m: 'POST', ...compilar(p), h }),
  listen: (port, cb) => http.createServer(manejar).listen(port, cb),
};
function compilar(p) {
  const keys = [];
  const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys };
}
function mejorarRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); };
  res.send = (t) => res.end(String(t));
  res.sendStatus = (c) => { res.statusCode = c; res.end(String(c)); };
}
function servirEstatico(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}
async function manejar(req, res) {
  mejorarRes(res);
  const url = new URL(req.url, 'http://x');
  req.query = Object.fromEntries(url.searchParams);
  req.get = (h) => req.headers[h.toLowerCase()];
  try {
    for (const r of rutas) {
      if (r.m !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      if (req.method === 'POST') req.body = await leerJSON(req);
      let i = 0;
      const next = async () => { const h = r.h[i++]; if (h) await h(req, res, next); };
      return await next();
    }
    if (req.method === 'GET' && servirEstatico(req, res, url.pathname)) return;
    res.status(404).json({ error: 'No encontrado' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: 'Error interno' });
  }
}
function leerJSON(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

// Carta pública
app.get('/api/menu', (req, res) => res.json(loadMenu()));
app.get('/api/config', (req, res) => res.json({ mock: MP_MOCK, mesas: CANT_MESAS }));

// ---------- Crear pedido ----------
app.post('/api/pedidos', async (req, res) => {
  try {
    const menu = loadMenu();
    const { items, modo, mesa, nombre, telefono, hora_retiro, notas } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'El pedido está vacío.' });
    if (!['mesa', 'takeaway'].includes(modo)) return res.status(400).json({ error: 'Elegí mesa o take away.' });
    const nombreLimpio = String(nombre || '').trim().slice(0, 40);
    if (!nombreLimpio) return res.status(400).json({ error: 'Falta tu nombre.' });
    let mesaNum = null;
    if (modo === 'mesa') {
      mesaNum = parseInt(mesa, 10);
      if (!mesaNum || mesaNum < 1 || mesaNum > CANT_MESAS) return res.status(400).json({ error: 'Número de mesa inválido.' });
    }
    const tel = String(telefono || '').replace(/[^\d+]/g, '').slice(0, 20);
    if (modo === 'takeaway' && tel.length < 8) return res.status(400).json({ error: 'Para take away necesitamos un teléfono.' });

    // Los precios SIEMPRE se toman del servidor, nunca del cliente
    const lineas = [];
    for (const it of items.slice(0, 50)) {
      const p = menu.productos.find((x) => x.id === it.id);
      const qty = Math.min(Math.max(parseInt(it.qty, 10) || 0, 0), 20);
      if (!p || !qty) continue;
      if (!p.disponible) return res.status(400).json({ error: `${p.nombre} no está disponible ahora.` });
      lineas.push({ id: p.id, nombre: p.nombre, precio: p.precio, qty, subtotal: p.precio * qty });
    }
    if (!lineas.length) return res.status(400).json({ error: 'El pedido está vacío.' });
    const total = lineas.reduce((a, l) => a + l.subtotal, 0);

    const id = crypto.randomUUID();
    const pedido = {
      id,
      numero: null, // se asigna al confirmarse el pago
      estado: 'pendiente_pago',
      modo,
      mesa: mesaNum,
      nombre: nombreLimpio,
      telefono: tel,
      hora_retiro: modo === 'takeaway' ? String(hora_retiro || 'Lo antes posible').slice(0, 30) : null,
      notas: String(notas || '').trim().slice(0, 200),
      items: lineas,
      total,
      creado: new Date().toISOString(),
      pagado: null,
      pago_id: null,
    };
    db.pedidos[id] = pedido;
    save();

    let checkoutUrl;
    if (MP_MOCK) {
      checkoutUrl = `${BASE_URL}/pago-simulado?pedido=${id}`;
    } else {
      checkoutUrl = await crearPreferenciaMP(pedido);
    }
    res.json({ id, checkout_url: checkoutUrl, total });
  } catch (e) {
    console.error('Error creando pedido', e);
    res.status(500).json({ error: 'No pudimos generar el pago. Probá de nuevo o avisá al mozo.' });
  }
});

async function crearPreferenciaMP(pedido) {
  const menu = loadMenu();
  const body = {
    items: pedido.items.map((l) => ({
      id: l.id,
      title: l.nombre,
      quantity: l.qty,
      unit_price: l.precio,
      currency_id: 'ARS',
    })),
    payer: { name: pedido.nombre },
    external_reference: pedido.id,
    notification_url: `${BASE_URL}/api/webhooks/mercadopago`,
    back_urls: {
      success: `${BASE_URL}/estado?pedido=${pedido.id}`,
      pending: `${BASE_URL}/estado?pedido=${pedido.id}`,
      failure: `${BASE_URL}/estado?pedido=${pedido.id}`,
    },
    auto_return: 'approved',
    statement_descriptor: (menu.negocio.nombre || 'GARDEN CAFE').toUpperCase().slice(0, 22),
    expires: true,
    expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    metadata: { pedido_id: pedido.id, modo: pedido.modo, mesa: pedido.mesa },
  };
  const r = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': pedido.id,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error('MP preference error: ' + JSON.stringify(data));
  pedido.preferencia_id = data.id;
  save();
  return data.init_point;
}

// ---------- Verificación de pago ----------
async function obtenerPagoMP(paymentId) {
  const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });
  if (!r.ok) throw new Error(`No se pudo consultar el pago ${paymentId}: ${r.status}`);
  return r.json();
}

// Aplica el resultado de un pago YA consultado a Mercado Pago (fuente de verdad)
function aplicarPago(pago) {
  const pedido = db.pedidos[pago.external_reference];
  if (!pedido) return { ok: false, motivo: 'pedido inexistente' };

  if (pago.status === 'approved') {
    if (pedido.estado !== 'pendiente_pago' && pedido.estado !== 'rechazado') return { ok: true, pedido, repetido: true };
    const montoOk = Number(pago.transaction_amount) + 0.01 >= pedido.total && (pago.currency_id || 'ARS') === 'ARS';
    if (!montoOk) {
      pedido.estado = 'revisar_pago';
      pedido.pago_id = String(pago.id);
      save();
      console.warn('Monto no coincide', pedido.id, pago.transaction_amount, pedido.total);
      emitir('pedido', publicoPanel(pedido));
      return { ok: false, motivo: 'monto no coincide', pedido };
    }
    pedido.estado = 'pagado';
    pedido.pagado = new Date().toISOString();
    pedido.pago_id = String(pago.id);
    pedido.numero = siguienteNumero();
    save();
    console.log(`✅ Pedido #${pedido.numero} pagado (${fmt(pedido.total)}) - ${pedido.modo}`);
    despacharPedido(pedido);
    return { ok: true, pedido };
  }
  if (['rejected', 'cancelled'].includes(pago.status) && pedido.estado === 'pendiente_pago') {
    pedido.estado = 'rechazado';
    save();
  }
  return { ok: false, motivo: pago.status, pedido };
}

// Validación de firma x-signature de Mercado Pago
function firmaValida(req, dataId) {
  if (!MP_WEBHOOK_SECRET) return true; // si no configuraste la clave, igual se verifica consultando el pago a MP
  const sig = req.get('x-signature') || '';
  const requestId = req.get('x-request-id') || '';
  const partes = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : dataId;
  let manifest = '';
  if (id) manifest += `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${partes.ts};`;
  const hmac = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(partes.v1)); } catch { return false; }
}

app.post('/api/webhooks/mercadopago', async (req, res) => {
  const tipo = req.query.type || req.query.topic || req.body?.type;
  const dataId = req.query['data.id'] || req.query.id || req.body?.data?.id;
  if (!firmaValida(req, dataId)) {
    console.warn('Webhook con firma inválida');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // respondemos rápido; MP reintenta si no
  if (tipo !== 'payment' || !dataId || MP_MOCK) return;
  if (db.pagosProcesados[dataId] === 'approved') return;
  try {
    const pago = await obtenerPagoMP(dataId);
    db.pagosProcesados[dataId] = pago.status;
    aplicarPago(pago);
  } catch (e) {
    console.error('Error procesando webhook', e.message);
  }
});

// Respaldo: cuando el cliente vuelve de MP con payment_id verificamos al instante
app.post('/api/pedidos/:id/verificar', async (req, res) => {
  const pedido = db.pedidos[req.params.id];
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  const paymentId = String(req.body?.payment_id || '').replace(/\D/g, '');
  if (!MP_MOCK && paymentId && pedido.estado === 'pendiente_pago') {
    try {
      const pago = await obtenerPagoMP(paymentId);
      if (pago.external_reference === pedido.id) aplicarPago(pago);
    } catch (e) { console.error(e.message); }
  }
  res.json(publicoCliente(pedido));
});

app.get('/api/pedidos/:id', (req, res) => {
  const pedido = db.pedidos[req.params.id];
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(publicoCliente(pedido));
});

function publicoCliente(p) {
  return { id: p.id, numero: p.numero, estado: p.estado, modo: p.modo, mesa: p.mesa, nombre: p.nombre, hora_retiro: p.hora_retiro, items: p.items, total: p.total, notas: p.notas };
}
function publicoPanel(p) { return { ...publicoCliente(p), telefono: p.telefono, creado: p.creado, pagado: p.pagado, pago_id: p.pago_id }; }

// ---------- Modo prueba (sin Mercado Pago real) ----------
app.post('/api/simular-pago/:id', (req, res) => {
  if (!MP_MOCK) return res.status(403).json({ error: 'Deshabilitado en producción' });
  const pedido = db.pedidos[req.params.id];
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  const aprobado = req.body?.resultado !== 'rechazado';
  aplicarPago({ id: 'TEST-' + Date.now(), status: aprobado ? 'approved' : 'rejected', external_reference: pedido.id, transaction_amount: pedido.total, currency_id: 'ARS' });
  res.json(publicoCliente(pedido));
});

// ---------- Despacho: panel + impresión + WhatsApp ----------
function despacharPedido(pedido) {
  emitir('pedido', publicoPanel(pedido));
  enviarWhatsApp(pedido).catch((e) => console.error('WhatsApp:', e.message));
}

function textoPedido(p) {
  const destino = p.modo === 'mesa' ? `🍽️ MESA ${p.mesa}` : `🛍️ TAKE AWAY · retira ${p.hora_retiro}`;
  const lineas = p.items.map((l) => `• ${l.qty} x ${l.nombre}`).join('\n');
  return `☕ *Garden Café · Pedido #${String(p.numero).padStart(3, '0')}* (PAGADO ✅)\n${destino}\n👤 ${p.nombre}${p.telefono ? ' · ' + p.telefono : ''}\n\n${lineas}${p.notas ? `\n\n📝 ${p.notas}` : ''}\n\nTotal: ${fmt(p.total)} · MP #${p.pago_id}`;
}

async function enviarWhatsApp(p) {
  const texto = textoPedido(p);
  const modo = (process.env.WHATSAPP_MODO || '').toLowerCase();
  if (modo === 'callmebot' && process.env.CALLMEBOT_TELEFONO && process.env.CALLMEBOT_APIKEY) {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(process.env.CALLMEBOT_TELEFONO)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(process.env.CALLMEBOT_APIKEY)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('CallMeBot ' + r.status);
  } else if (modo === 'cloud' && process.env.WA_TOKEN && process.env.WA_PHONE_ID && process.env.WA_DESTINO) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: process.env.WA_DESTINO, type: 'text', text: { body: texto } }),
    });
    if (!r.ok) throw new Error('WhatsApp Cloud ' + r.status + ' ' + (await r.text()));
  } else {
    console.log('[WhatsApp desactivado] Mensaje que se enviaría:\n' + texto);
  }
}

// ---------- Panel de cocina (con contraseña) ----------
function firmar(v) { return crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex'); }
function tokenPanel() { const exp = Date.now() + 1000 * 60 * 60 * 24 * 30; return `${exp}.${firmar(String(exp))}`; }
function leerCookie(req, nombre) {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(nombre + '='));
  return m ? decodeURIComponent(m.slice(nombre.length + 1)) : '';
}
function autorizado(req) {
  const [exp, sig] = leerCookie(req, 'panel').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(firmar(exp))); } catch { return false; }
}
function soloPanel(req, res, next) { if (autorizado(req)) return next(); res.status(401).json({ error: 'No autorizado' }); }

app.post('/api/panel/login', (req, res) => {
  const pass = String(req.body?.password || '');
  const ok = pass.length === PANEL_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(PANEL_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
  const secure = BASE_URL.startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `panel=${tokenPanel()}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${secure}`);
  res.json({ ok: true });
});
app.get('/api/panel/sesion', (req, res) => res.json({ ok: autorizado(req) }));

const ESTADOS_COCINA = ['pagado', 'en_preparacion', 'listo', 'entregado', 'revisar_pago'];
app.get('/api/panel/pedidos', soloPanel, (req, res) => {
  const hace24 = Date.now() - 24 * 3600 * 1000;
  const lista = Object.values(db.pedidos)
    .filter((p) => ESTADOS_COCINA.includes(p.estado) && new Date(p.pagado || p.creado).getTime() > hace24)
    .sort((a, b) => (a.pagado || a.creado).localeCompare(b.pagado || b.creado))
    .map(publicoPanel);
  res.json(lista);
});

app.post('/api/panel/pedidos/:id/estado', soloPanel, (req, res) => {
  const p = db.pedidos[req.params.id];
  const estado = req.body?.estado;
  if (!p) return res.status(404).json({ error: 'No existe' });
  if (!['en_preparacion', 'listo', 'entregado'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  if (p.estado === 'revisar_pago' && estado === 'en_preparacion') {
    // El encargado verificó el pago a mano en Mercado Pago y lo aprueba
    p.numero = siguienteNumero();
    p.pagado = new Date().toISOString();
  } else if (!['pagado', 'en_preparacion', 'listo', 'entregado'].includes(p.estado)) return res.status(400).json({ error: 'El pedido no está pagado' });
  p.estado = estado;
  save();
  emitir('pedido', publicoPanel(p));
  res.json(publicoPanel(p));
});

// Resumen del día
app.get('/api/panel/resumen', soloPanel, (req, res) => {
  const hoy = hoyAR();
  const pagados = Object.values(db.pedidos).filter((p) => p.pagado && new Date(p.pagado).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) === hoy);
  res.json({
    pedidos: pagados.length,
    total: pagados.reduce((a, p) => a + p.total, 0),
    mesa: pagados.filter((p) => p.modo === 'mesa').length,
    takeaway: pagados.filter((p) => p.modo === 'takeaway').length,
  });
});

// Tiempo real (Server-Sent Events)
const clientesSSE = new Set();
app.get('/api/panel/stream', soloPanel, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  clientesSSE.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clientesSSE.delete(res); });
});
function emitir(evento, data) {
  const msg = `event: ${evento}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clientesSSE) c.write(msg);
}

// ---------- Datos para el generador de QR (se dibujan en el navegador) ----------
app.get('/api/panel/qrs', soloPanel, (req, res) => {
  const lista = [];
  for (let i = 1; i <= CANT_MESAS; i++) lista.push({ titulo: `Mesa ${i}`, url: `${BASE_URL}/?mesa=${i}` });
  lista.push({ titulo: 'Take away', url: `${BASE_URL}/?modo=takeaway` });
  res.json(lista);
});

app.get('/healthz', (req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`\n☕ Garden Café corriendo en ${BASE_URL}`);
  console.log(`   Carta:  ${BASE_URL}/?mesa=1`);
  console.log(`   Panel:  ${BASE_URL}/panel`);
  console.log(`   Modo pago: ${MP_MOCK ? 'PRUEBA (sin Mercado Pago real)' : 'Mercado Pago REAL'}\n`);
});
