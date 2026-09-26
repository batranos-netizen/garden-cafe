// ===== Garden Café · Carta + Garden Bot =====
const $ = (s) => document.querySelector(s);
const fmt = (n) => '$' + Math.round(n).toLocaleString('es-AR');
const params = new URLSearchParams(location.search);

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Mesa / take away según el QR escaneado
if (params.get('mesa')) store.set('gc_origen', { modo: 'mesa', mesa: parseInt(params.get('mesa'), 10) });
if (params.get('modo') === 'takeaway') store.set('gc_origen', { modo: 'takeaway' });
const origen = store.get('gc_origen', null);

let MENU = null;
let CONFIG = { mesas: 12 };
let carrito = store.get('gc_carrito', {}); // { idProducto: cantidad }

function producto(id) { return MENU.productos.find((p) => p.id === id); }
function lineasCarrito() {
  return Object.entries(carrito)
    .map(([id, qty]) => ({ p: producto(id), qty }))
    .filter((l) => l.p && l.p.disponible && l.qty > 0);
}
function total() { return lineasCarrito().reduce((a, l) => a + l.p.precio * l.qty, 0); }
function cantidad() { return lineasCarrito().reduce((a, l) => a + l.qty, 0); }

function cambiar(id, delta) {
  carrito[id] = Math.max(0, Math.min(20, (carrito[id] || 0) + delta));
  if (!carrito[id]) delete carrito[id];
  store.set('gc_carrito', carrito);
  actualizarUI();
}

// ---------- Render carta ----------
async function iniciar() {
  const [m, c] = await Promise.all([fetch('/api/menu').then((r) => r.json()), fetch('/api/config').then((r) => r.json())]);
  MENU = m; CONFIG = c;
  const n = MENU.negocio;
  document.title = `${n.nombre} · Carta`;
  $('#nombre-negocio').textContent = n.nombre;
  $('#slogan').textContent = n.slogan;
  $('#chip-horario').textContent = '🕗 ' + n.horario;
  if (origen) {
    const chip = $('#chip-modo');
    chip.hidden = false;
    chip.textContent = origen.modo === 'mesa' ? `🍽️ Mesa ${origen.mesa}` : '🛍️ Take away';
  }
  $('#pie').innerHTML = `${n.nombre} · ${n.direccion}<br>${n.instagram ? '@' + n.instagram : ''}`;

  const tabs = $('#tabs');
  const carta = $('#carta');
  carta.innerHTML = '';
  for (const cat of MENU.categorias) {
    const prods = MENU.productos.filter((p) => p.categoria === cat.id);
    if (!prods.length) continue;
    const t = document.createElement('button');
    t.className = 'tab';
    t.textContent = `${cat.icono || ''} ${cat.nombre}`.trim();
    t.dataset.cat = cat.id;
    t.onclick = () => document.getElementById('cat-' + cat.id).scrollIntoView({ behavior: 'smooth' });
    tabs.appendChild(t);

    const sec = document.createElement('section');
    sec.className = 'cat';
    sec.id = 'cat-' + cat.id;
    sec.innerHTML = `<h2>${cat.icono || ''} ${cat.nombre}</h2><div class="lista"></div>`;
    const lista = sec.querySelector('.lista');
    for (const p of prods) {
      const el = document.createElement('article');
      el.className = 'prod' + (p.categoria === 'promos' ? ' promo' : '') + (p.disponible ? '' : ' agotado');
      el.innerHTML = `
        <div class="info">
          ${p.etiqueta ? `<span class="etiqueta">${p.etiqueta}</span>` : ''}
          <h3>${p.nombre}</h3>
          <p>${p.descripcion || ''}</p>
          <div class="precio">${fmt(p.precio)}${p.precio_anterior ? `<s>${fmt(p.precio_anterior)}</s>` : ''}</div>
        </div>
        ${p.disponible
          ? `<div class="cant" data-id="${p.id}"><button class="menos" aria-label="Quitar">−</button><span>0</span><button class="mas" aria-label="Agregar">+</button></div>`
          : `<span class="sin-stock">Sin stock</span>`}`;
      const cant = el.querySelector('.cant');
      if (cant) {
        cant.querySelector('.mas').onclick = () => cambiar(p.id, 1);
        cant.querySelector('.menos').onclick = () => cambiar(p.id, -1);
      }
      lista.appendChild(el);
    }
    carta.appendChild(sec);
  }
  // Tab activa según scroll
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('activa', 'cat-' + t.dataset.cat === e.target.id));
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('section.cat').forEach((s) => obs.observe(s));
  actualizarUI();
}

function actualizarUI() {
  document.querySelectorAll('.cant').forEach((c) => {
    const q = carrito[c.dataset.id] || 0;
    c.querySelector('span').textContent = q;
    c.querySelector('.menos').style.visibility = q ? 'visible' : 'hidden';
    c.querySelector('span').style.visibility = q ? 'visible' : 'hidden';
  });
  const cant = cantidad();
  $('#cant-items').textContent = cant;
  $('#total-barra').textContent = fmt(total());
  $('#barra').classList.toggle('visible', cant > 0);
  if (resumenVivo) pintarResumen(resumenVivo);
}

// ---------- Garden Bot ----------
const chat = $('#chat');
const opciones = $('#opciones');
let pedido = {};
let resumenVivo = null;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function botDice(html, { esElemento = false } = {}) {
  const typing = document.createElement('div');
  typing.className = 'msg bot-msg escribiendo';
  typing.textContent = 'escribiendo…';
  chat.appendChild(typing);
  scrollChat();
  await esperar(450);
  typing.remove();
  const m = document.createElement('div');
  m.className = 'msg bot-msg';
  if (esElemento) m.appendChild(html); else m.innerHTML = html;
  chat.appendChild(m);
  scrollChat();
  return m;
}
function yoDigo(texto) {
  const m = document.createElement('div');
  m.className = 'msg yo';
  m.textContent = texto;
  chat.appendChild(m);
  scrollChat();
}
function scrollChat() { chat.scrollTop = chat.scrollHeight; }

function botones(lista) {
  return new Promise((resolve) => {
    opciones.innerHTML = '';
    lista.forEach((b) => {
      const el = document.createElement('button');
      el.className = 'op' + (b.fuerte ? ' fuerte' : '');
      el.textContent = b.texto;
      el.onclick = () => { opciones.innerHTML = ''; if (!b.silencioso) yoDigo(b.texto); resolve(b.valor); };
      opciones.appendChild(el);
    });
  });
}
function preguntar({ placeholder, tipo = 'text', validar, extra }) {
  return new Promise((resolve) => {
    opciones.innerHTML = '';
    const f = document.createElement('form');
    f.innerHTML = `<input type="${tipo}" placeholder="${placeholder}" autocomplete="off" ${tipo === 'tel' ? 'inputmode="tel"' : ''} ${tipo === 'number' ? 'inputmode="numeric"' : ''}><button>Enviar</button>`;
    const input = f.querySelector('input');
    const err = document.createElement('div');
    err.className = 'error';
    f.onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      const problema = validar ? validar(v) : (!v ? 'Completá este dato' : null);
      if (problema) { err.textContent = problema; return; }
      opciones.innerHTML = '';
      yoDigo(v);
      resolve(v);
    };
    opciones.appendChild(f);
    if (extra) {
      const b = document.createElement('button');
      b.className = 'op';
      b.textContent = extra.texto;
      b.onclick = () => { opciones.innerHTML = ''; yoDigo(extra.texto); resolve(extra.valor); };
      opciones.appendChild(b);
    }
    opciones.appendChild(err);
    setTimeout(() => input.focus(), 50);
  });
}

function pintarResumen(cont) {
  const lineas = lineasCarrito();
  cont.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'resumen';
  lineas.forEach((l) => {
    const row = document.createElement('div');
    row.className = 'linea';
    row.innerHTML = `<span class="mini"><button data-a="-">−</button><b>${l.qty}</b><button data-a="+">+</button>&nbsp;${l.p.nombre}</span><span>${fmt(l.p.precio * l.qty)}</span>`;
    row.querySelector('[data-a="-"]').onclick = () => cambiar(l.p.id, -1);
    row.querySelector('[data-a="+"]').onclick = () => cambiar(l.p.id, 1);
    div.appendChild(row);
  });
  const t = document.createElement('div');
  t.className = 'linea total';
  t.innerHTML = `<span>Total</span><span>${fmt(total())}</span>`;
  div.appendChild(t);
  cont.appendChild(div);
}

function abrirBot() {
  $('#bot').classList.add('abierto');
  $('#bot').setAttribute('aria-hidden', 'false');
  flujo();
}
function cerrarBot() {
  $('#bot').classList.remove('abierto');
  $('#bot').setAttribute('aria-hidden', 'true');
  resumenVivo = null;
  chat.innerHTML = '';
  opciones.innerHTML = '';
  flujoId++;
}
let flujoId = 0;

async function flujo() {
  const miFlujo = ++flujoId;
  const vivo = () => miFlujo === flujoId;
  chat.innerHTML = '';
  pedido = {};
  const recordado = store.get('gc_cliente', {});

  await botDice(`¡Hola! 👋 Soy <b>Garden Bot</b>. Revisá tu pedido (podés sumar o quitar):`);
  if (!vivo()) return;
  const cont = document.createElement('div');
  resumenVivo = cont;
  pintarResumen(cont);
  await botDice(cont, { esElemento: true });
  const ok = await botones([{ texto: 'Seguir mirando la carta', valor: false }, { texto: 'Confirmar pedido ✓', valor: true, fuerte: true }]);
  if (!vivo()) return;
  if (!ok || cantidad() === 0) return cerrarBot();
  resumenVivo = null;
  cont.querySelectorAll('button').forEach((b) => b.remove());

  // ¿Mesa o take away?
  if (origen && origen.modo === 'mesa') {
    await botDice(`Veo que estás en la <b>Mesa ${origen.mesa}</b> 🍽️ ¿Te lo llevamos ahí?`);
    const r = await botones([{ texto: `Sí, a la mesa ${origen.mesa}`, valor: 'mesa', fuerte: true }, { texto: 'No, es para llevar', valor: 'takeaway' }]);
    pedido.modo = r;
    if (r === 'mesa') pedido.mesa = origen.mesa;
  } else if (origen && origen.modo === 'takeaway') {
    pedido.modo = 'takeaway';
    await botDice('Perfecto, tu pedido es <b>para llevar</b> 🛍️');
  } else {
    await botDice('¿Lo tomás acá o es para llevar?');
    pedido.modo = await botones([{ texto: '🍽️ Acá en el local', valor: 'mesa' }, { texto: '🛍️ Take away', valor: 'takeaway' }]);
  }
  if (!vivo()) return;
  if (pedido.modo === 'mesa' && !pedido.mesa) {
    await botDice('¿En qué número de mesa estás? (está en el QR de la mesa)');
    pedido.mesa = parseInt(await preguntar({ placeholder: 'Nº de mesa', tipo: 'number', validar: (v) => { const n = parseInt(v, 10); return n >= 1 && n <= CONFIG.mesas ? null : `Poné un número entre 1 y ${CONFIG.mesas}`; } }), 10);
  }
  if (!vivo()) return;

  // Nombre
  if (recordado.nombre) {
    await botDice(`¿El pedido va a nombre de <b>${escapar(recordado.nombre)}</b>?`);
    const r = await botones([{ texto: 'Sí', valor: true, fuerte: true }, { texto: 'Otro nombre', valor: false }]);
    pedido.nombre = r ? recordado.nombre : null;
  }
  if (!pedido.nombre) {
    await botDice('¿A nombre de quién lo anotamos?');
    pedido.nombre = await preguntar({ placeholder: 'Tu nombre', validar: (v) => (v.length < 2 ? 'Escribí tu nombre' : null) });
  }
  if (!vivo()) return;

  // Take away: teléfono y horario
  if (pedido.modo === 'takeaway') {
    await botDice('¿A qué número te avisamos cuando esté listo? 📱');
    pedido.telefono = await preguntar({ placeholder: 'Ej: 11 2345 6789', tipo: 'tel', validar: (v) => (v.replace(/\D/g, '').length < 8 ? 'Revisá el número' : null) });
    if (!vivo()) return;
    const min = MENU.negocio.takeaway_minutos || 15;
    await botDice('¿Cuándo pasás a retirar?');
    pedido.hora_retiro = await botones([
      { texto: `Lo antes posible (~${min} min)`, valor: `Lo antes posible (~${min} min)` },
      { texto: 'En 30 minutos', valor: 'En 30 min' },
      { texto: 'En 1 hora', valor: 'En 1 hora' },
    ]);
  }
  if (!vivo()) return;
  store.set('gc_cliente', { nombre: pedido.nombre });

  // Aclaraciones
  await botDice('¿Alguna aclaración para la cocina? (sin azúcar, leche vegetal, sin TACC…)');
  const nota = await preguntar({ placeholder: 'Escribí tu aclaración', validar: () => null, extra: { texto: 'No, nada más', valor: '' } });
  pedido.notas = nota === 'No, nada más' ? '' : nota;
  if (!vivo()) return;

  // Resumen final + pago
  const destino = pedido.modo === 'mesa' ? `🍽️ Mesa ${pedido.mesa}` : `🛍️ Take away · ${pedido.hora_retiro}`;
  await botDice(`Listo, <b>${escapar(pedido.nombre)}</b>. Este es tu pedido:<br><br>${destino}<br>${lineasCarrito().map((l) => `• ${l.qty} × ${l.p.nombre}`).join('<br>')}${pedido.notas ? `<br>📝 ${escapar(pedido.notas)}` : ''}<br><br><b>Total: ${fmt(total())}</b>`);
  await botDice('Pagalo con Mercado Pago (tarjeta, débito, dinero en cuenta o QR). Apenas se confirme el pago, lo mandamos a cocina 👩‍🍳');
  if (!vivo()) return;
  mostrarBotonPago();
}

function mostrarBotonPago() {
  opciones.innerHTML = '';
  const b = document.createElement('button');
  b.className = 'btn-mp';
  b.innerHTML = `Pagar ${fmt(total())} con Mercado Pago`;
  const err = document.createElement('div');
  err.className = 'error';
  b.onclick = async () => {
    b.disabled = true;
    b.textContent = 'Generando pago seguro…';
    err.textContent = '';
    try {
      const r = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pedido, items: lineasCarrito().map((l) => ({ id: l.p.id, qty: l.qty })) }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error');
      store.set('gc_ultimo_pedido', data.id);
      location.href = data.checkout_url;
    } catch (e) {
      err.textContent = e.message;
      b.disabled = false;
      b.innerHTML = `Pagar ${fmt(total())} con Mercado Pago`;
    }
  };
  opciones.appendChild(b);
  opciones.appendChild(err);
}

function escapar(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

$('#btn-carrito').onclick = abrirBot;
$('#cerrar-bot').onclick = cerrarBot;
iniciar().catch(() => { $('#carta').innerHTML = '<p class="centro">No pudimos cargar la carta. Recargá la página.</p>'; });
