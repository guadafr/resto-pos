// ===================================================
// RestoPOS – Servidor LAN/Render con archivos JSON + SSE
// ===================================================
// Requisitos: npm i express cors fs-extra

const express = require('express');
const cors = require('cors');
const path = require('path');
const fse = require('fs-extra');
const { EventEmitter } = require('events');

// ====== Config básica ======
const SERVER_VERSION = 'RestoPOS-API v4';
const ROOT       = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT);
const DATA_DIR   = path.join(ROOT, 'data');
const PORT       = process.env.PORT || 3002;
const HOST       = '0.0.0.0';

// ====== Archivos de datos ======
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const MOZOS_FILE    = path.join(DATA_DIR, 'mozos.json');
const ORDERS_FILE   = path.join(DATA_DIR, 'orders.json');
const CASH_FILE     = path.join(DATA_DIR, 'cash.json');

// ====== App + Bus ======
const app = express();
const bus = new EventEmitter();
function broadcast(type, payload = {}) {
  bus.emit('evt', { type, payload, ts: Date.now() });
}

// ====== Middlewares ======
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ====== Helpers ======
async function ensureData() {
  await fse.ensureDir(DATA_DIR);
  for (const file of [PRODUCTS_FILE, MOZOS_FILE, ORDERS_FILE, CASH_FILE]) {
    if (!(await fse.pathExists(file))) await fse.writeJSON(file, [], { spaces: 2 });
  }
}
async function readJSON(file, fallback = []) {
  try {
    const raw = await fse.readFile(file, 'utf8');
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : (fallback ?? []);
  } catch {
    return fallback ?? [];
  }
}
async function writeJSON(file, data) {
  await fse.writeJSON(file, data, { spaces: 2 });
}
const nowISO = () => new Date().toISOString();
function mapPagoKey(tipo = '') {
  const t = (tipo || '').toLowerCase();
  if (t.includes('efectivo')) return 'efectivo';
  if (t.includes('tarjeta')) return 'tarjeta';
  if (t.includes('transfer')) return 'transferencia';
  if (t.includes('qr') || t.includes('mp') || t.includes('mercado') || t.includes('pedido')) return 'qr';
  return 'otros';
}
function normalizeBox(box) {
  if (!box) return null;
  box.ventasByPay   = Object.assign({ efectivo:0, tarjeta:0, transferencia:0, qr:0, otros:0 }, box.ventasByPay || {});
  box.ingresosByPay = Object.assign({ efectivo:0, tarjeta:0, transferencia:0, qr:0, otros:0 }, box.ingresosByPay || {});
  box.egresosByPay  = Object.assign({ efectivo:0, tarjeta:0, transferencia:0, qr:0, otros:0 }, box.egresosByPay || {});
  box.movs = box.movs || [];
  box.ventasTotal   = box.ventasTotal   || 0;
  box.ingresosTotal = box.ingresosTotal || 0;
  box.egresosTotal  = box.egresosTotal  || 0;
  return box;
}

// ====== Rutas util ======
app.get('/api/version', (_req, res) => res.json({ ok: true, version: SERVER_VERSION }));
app.get('/api/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ====== SSE ======
app.get('/api/events', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');
  res.write('retry: 3000\n\n');
  const send = ({ type, payload }) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  send({ type: 'hello', payload: { ok: true } });
  const listener = (evt) => send(evt);
  bus.on('evt', listener);
  req.on('close', () => bus.off('evt', listener));
});

// ====== Bootstrap ======
app.get('/api/bootstrap', async (_req, res) => {
  const cfgPath = path.join(ROOT, 'config.json');
  const config = (await fse.pathExists(cfgPath))
    ? JSON.parse(await fse.readFile(cfgPath, 'utf8'))
    : {};
  const products = await readJSON(PRODUCTS_FILE, []);
  const mozos    = await readJSON(MOZOS_FILE, []);
  res.json({ ok: true, config, products, mozos });
});

// ====== Productos ======
app.get('/api/products', async (_req, res) => res.json(await readJSON(PRODUCTS_FILE, [])));
app.post('/api/products', async (req, res) => {
  const p = req.body || {};
  if (!p.id) return res.status(400).json({ ok: false, error: 'missing_id' });
  const list = await readJSON(PRODUCTS_FILE, []);
  const idx = list.findIndex(x => String(x.id) === String(p.id));
  if (idx >= 0) list.splice(idx, 1, p); else list.push(p);
  await writeJSON(PRODUCTS_FILE, list);
  broadcast('products_changed', { count: list.length, id: p.id, action: (idx >= 0 ? 'update' : 'insert') });
  res.json({ ok: true });
});
app.delete('/api/products/:id', async (req, res) => {
  const id = String(req.params.id || '');
  let list = await readJSON(PRODUCTS_FILE, []);
  const prev = list.length;
  list = list.filter(x => String(x.id) !== id);
  await writeJSON(PRODUCTS_FILE, list);
  if (list.length !== prev) broadcast('products_changed', { count: list.length, id, action: 'delete' });
  res.json({ ok: true });
});

// ====== Mozos ======
app.get('/api/mozos', async (_req, res) => res.json(await readJSON(MOZOS_FILE, [])));
app.post('/api/mozos', async (req, res) => {
  const m = req.body || {};
  if (!m.id) return res.status(400).json({ ok: false, error: 'missing_id' });
  const list = await readJSON(MOZOS_FILE, []);
  const idx = list.findIndex(x => String(x.id) === String(m.id));
  if (idx >= 0) list.splice(idx, 1, m); else list.push(m);
  await writeJSON(MOZOS_FILE, list);
  broadcast('mozos_changed', { count: list.length, id: m.id, action: (idx >= 0 ? 'update' : 'insert') });
  res.json({ ok: true });
});
app.delete('/api/mozos/:id', async (req, res) => {
  const id = String(req.params.id || '');
  let list = await readJSON(MOZOS_FILE, []);
  const prev = list.length;
  list = list.filter(x => String(x.id) !== id);
  await writeJSON(MOZOS_FILE, list);
  if (list.length !== prev) broadcast('mozos_changed', { count: list.length, id, action: 'delete' });
  res.json({ ok: true });
});

// ====== Pedidos ======
function genId() {
  return Math.floor(Date.now() / 1000);
}
function genClientId() {
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Crear / Actualizar pedido
app.post('/api/orders', async (req, res) => {
  const o = req.body || {};
  const list = await readJSON(ORDERS_FILE, []);

  if (!o.clientId) o.clientId = genClientId();

  let idx = -1;
  if (o.id != null) idx = list.findIndex(x => +x.id === +o.id);
  if (idx < 0) idx = list.findIndex(x => x.clientId === o.clientId);

  if (idx < 0) {
    const maxId = list.reduce((m, x) => Math.max(m, +x.id || 0), 0);
    o.id = o.id != null ? +o.id : (maxId + 1) || genId();
    o.estado = o.estado || 'abierto';
    o.inicio = o.inicio || new Date().toISOString();
    list.push(o);
    await writeJSON(ORDERS_FILE, list);
    broadcast('orders_changed', { id: o.id, action: 'insert' });
    return res.json({ ok: true, order: o, id: o.id });
  } else {
    const merged = { ...list[idx], ...o, id: (+list[idx].id || +o.id), clientId: list[idx].clientId || o.clientId };
    list.splice(idx, 1, merged);
    await writeJSON(ORDERS_FILE, list);
    broadcast('orders_changed', { id: merged.id, action: 'update' });
    return res.json({ ok: true, order: merged, id: merged.id });
  }
});

// Obtener pedidos
app.get('/api/orders', async (req, res) => {
  const { estado, tipo, date } = req.query || {};
  const list = await readJSON(ORDERS_FILE, []);
  let out = list;
  if (estado) out = out.filter(o => String(o.estado) === String(estado));
  if (tipo) out = out.filter(o => String(o.tipo) === String(tipo));
  if (date) out = out.filter(o => String(o.fecha || '').slice(0, 10) === String(date).slice(0, 10));
  res.json({ ok: true, orders: out });
});

// Pedidos abiertos
app.get('/api/orders/open', async (_req, res) => {
  const list = await readJSON(ORDERS_FILE, []);
  res.json({ ok: true, orders: list.filter(o => o.estado === 'abierto') });
});

// Cambiar estado
app.post('/api/orders/:id/status', async (req, res) => {
  const id = +req.params.id;
  const { estado, motivo, patch } = req.body || {};
  const list = await readJSON(ORDERS_FILE, []);
  const idx = list.findIndex(x => +x.id === id);
  if (idx < 0) return res.status(404).json({ ok: false });
  if (estado) list[idx].estado = estado;
  if (motivo) { list[idx].cancelReason = motivo; list[idx].cancelTs = nowISO(); }
  if (patch) Object.assign(list[idx], patch);
  await writeJSON(ORDERS_FILE, list);
  broadcast('orders_changed', { id, action: 'status', estado, order: list[idx] });
  res.json({ ok: true, order: list[idx] });
});

// Cobrar pedido
app.post('/api/orders/:id/charge', async (req, res) => {
  const id = +req.params.id;
  const { pagos = [], descuento = 0 } = req.body || {};
  const list = await readJSON(ORDERS_FILE, []);
  const idx = list.findIndex(x => +x.id === id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'not_found' });

  const order = list[idx];
  const total = (order.items || []).reduce((a, b) => a + (b.precio || 0) * (b.cant || 0), 0);
  const aCobrar = Math.max(0, total - Math.max(0, +descuento || 0));
  const sumaPago = (pagos || []).reduce((a, p) => a + (+p.monto || 0), 0);
  if (sumaPago !== aCobrar) {
    return res.status(400).json({ ok: false, error: 'sum_mismatch', total, descuento, aCobrar, sumaPagos: sumaPago });
  }

  const prods = await readJSON(PRODUCTS_FILE, []);
  let changed = false;
  for (const it of (order.items || [])) {
    const p = prods.find(x => String(x.id) === String(it.id));
    if (p && p.trackStock) { p.stock = Math.max(0, (p.stock || 0) - (it.cant || 0)); changed = true; }
  }
  if (changed) { await writeJSON(PRODUCTS_FILE, prods); broadcast('products_changed', { count: prods.length }); }

  order.total        = total;
  order.descuento    = Math.max(0, +descuento || 0);
  order.totalCobrado = aCobrar;
  order.pagos        = pagos;
  order.estado       = 'cerrado';
  order.cierre       = nowISO();
  list.splice(idx, 1, order);
  await writeJSON(ORDERS_FILE, list);

  broadcast('order_closed', { id: order.id, order });
  broadcast('orders_changed', { id: order.id, action: 'closed' });
  res.json({ ok: true, order, id: order.id });
});

// ====== Caja ======
app.post('/api/cash/open', async (req, res) => {
  const { apertura = 0, cajero = '', turno = '' } = req.body || {};
  const list = await readJSON(CASH_FILE, []);
  const open = list.find(b => !b.cierre);
  if (open) return res.json(normalizeBox(open));

  const box = normalizeBox({
    apertura: Math.max(0, +apertura || 0),
    aperturaTs: nowISO(),
    cajero, turno,
    movs: [],
    ventasByPay:{ efectivo:0, tarjeta:0, transferencia:0, qr:0, otros:0 },
    ingresosByPay:{ efectivo:0, tarjeta:0, transferencia:0, qr:0, otros:0 },
    egresosByPay:{ efectivo:0, tarjeta:0, transferencia:0, qr:0, otros:0 },
    ventasTotal:0, ingresosTotal:0, egresosTotal:0
  });
  list.push(box);
  await writeJSON(CASH_FILE, list);
  broadcast('cash_updated', { action: 'open' });
  res.json(box);
});
app.get('/api/cash/open', async (_req, res) => {
  const list = await readJSON(CASH_FILE, []);
  const open = list.find(b => !b.cierre);
  if (!open) return res.status(404).json({ ok: false, error: 'no_open_box' });
  res.json(normalizeBox(open));
});
app.post('/api/cash/mov', async (req, res) => {
  const { tipo, medio = '', desc = '', monto = 0 } = req.body || {};
  const list = await readJSON(CASH_FILE, []);
  const idx = list.findIndex(b => !b.cierre);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'no_open_box' });

  const box = normalizeBox(list[idx]);
  const key = mapPagoKey(medio);
  const m = Math.max(0, +monto || 0);
  box.movs.push({ ts: nowISO(), tipo, medio, desc, monto: m });

  if (tipo === 'ingreso') {
    box.ingresosTotal += m;
    box.ingresosByPay[key] = (box.ingresosByPay[key] || 0) + m;
  } else {
    box.egresosTotal += m;
    box.egresosByPay[key] = (box.egresosByPay[key] || 0) + m;
  }
  list.splice(idx, 1, box);
  await writeJSON(CASH_FILE, list);
  broadcast('cash_updated', { action: 'mov' });
  res.json(normalizeBox(box));
});
app.post('/api/cash/close', async (req, res) => {
  const { conteo = 0 } = req.body || {};
  const list = await readJSON(CASH_FILE, []);
  const idx = list.findIndex(b => !b.cierre);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'no_open_box' });

  const box = normalizeBox(list[idx]);
  const efEsperado = (box.apertura || 0)
                   + (box.ingresosByPay.efectivo || 0)
                   + (box.ventasByPay.efectivo || 0)
                   - (box.egresosByPay.efectivo || 0);

  box.cierre = true;
  box.cierreTs = nowISO();
  box.conteo = Math.max(0, +conteo || 0);
  box.efectivoEsperado = efEsperado;
  box.diferenciaEf = box.conteo - efEsperado;
  box.final = (box.apertura || 0) + (box.ingresosTotal || 0) + (box.ventasTotal || 0) - (box.egresosTotal || 0);

  list.splice(idx, 1, box);
  await writeJSON(CASH_FILE, list);
  broadcast('cash_updated', { action: 'close' });
  res.json(normalizeBox(box));
});
app.get('/api/cash/history', async (req, res) => {
  const desde = String(req.query.desde || '');
  const hasta = String(req.query.hasta || '');
  const list = await readJSON(CASH_FILE, []);
  const closed = list.filter(b => b.cierre).sort((a,b)=> new Date(a.aperturaTs)-new Date(b.aperturaTs));
  const inRange = b => {
    const day = String(b.aperturaTs || '').slice(0,10);
    return (!desde || day >= desde) && (!hasta || day <= hasta);
  };
  res.json(closed.filter(inRange).map(normalizeBox));
});

// ====== Estáticos ======
app.use('/data', (_req, res) => res.status(403).end());
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, f) => { if (f.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); }
}));
app.get(['/', '/index.html', '/admin.html', '/mozo.html', '/cocina.html'], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, req.path === '/' ? 'index.html' : req.path));
});

// ====== Start ======
(async () => {
  await ensureData();
  app.listen(PORT, HOST, () => console.log(`✅ API lista en http://${HOST}:${PORT}`));
})();
