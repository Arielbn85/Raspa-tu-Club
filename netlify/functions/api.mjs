import { getStore } from '@netlify/blobs';

// Tabla de premios: serie de 200 cartones con 32 ganadores (1 de cada 6); devuelve el 37,5% (750 de 2000 pts)
const PER_SERIES = 200;
const PRECIO_CANJE = 10; // puntos por cartón

const CLUBS = [
  { id: 'oli', name: 'Olimpia',       pts: 150, n: 1 },
  { id: 'ccp', name: 'Cerro Porteño', pts: 80,  n: 1 },
  { id: 'lib', name: 'Libertad',      pts: 50,  n: 1 },
  { id: 'gua', name: 'Guaraní',       pts: 40,  n: 1 },
  { id: 'nac', name: 'Nacional',      pts: 25,  n: 2 },
  { id: 'luq', name: 'Sp. Luqueño',   pts: 25,  n: 2 },
  { id: 'tri', name: 'Trinidense',    pts: 20,  n: 2 },
  { id: 'ame', name: 'Ameliano',      pts: 20,  n: 2 },
  { id: 'slo', name: 'San Lorenzo',   pts: 20,  n: 2 },
  { id: 'rec', name: 'Recoleta',      pts: 15,  n: 3 },
  { id: 'dos', name: '2 de Mayo',     pts: 15,  n: 3 },
  { id: 'rnu', name: 'Rubio Ñu',      pts: 0,   n: 12, free: true } // premio: otro cartón
];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Serie cerrada: los resultados se fijan al crearla, así el porcentaje de premios está garantizado
function newSeries(num) {
  const out = [];
  CLUBS.forEach((c, i) => { for (let k = 0; k < c.n; k++) out.push(i); });
  while (out.length < PER_SERIES) out.push(-1);
  return { num, v: 2, pos: 0, outcomes: shuffle(out) };
}

// Arma las 9 casillas: si gana, 3 del club ganador; ningún otro club aparece más de 2 veces
function makeCells(win) {
  const pool = [];
  CLUBS.forEach((c, i) => { if (i !== win) pool.push(i, i); });
  shuffle(pool);
  const cells = win >= 0 ? [win, win, win, ...pool.slice(0, 6)] : pool.slice(0, 9);
  return shuffle(cells).map(i => CLUBS[i].id);
}

function prizeTable(st) {
  const left = CLUBS.map(() => 0);
  for (let k = st.series.pos; k < PER_SERIES; k++) {
    const o = st.series.outcomes[k];
    if (o >= 0) left[o]++;
  }
  return {
    serie: st.series.num,
    quedan: PER_SERIES - st.series.pos,
    total: PER_SERIES,
    clubes: CLUBS.map((c, i) => ({ id: c.id, name: c.name, pts: c.pts, free: !!c.free, n: c.n, quedan: left[i] }))
  };
}


// Lo que ve el jugador: solo nombres y premios, sin lo que queda en la serie
function playerTable() {
  return { clubes: CLUBS.map(c => ({ id: c.id, name: c.name, pts: c.pts, free: !!c.free })) };
}

const KEY = 'estado';

async function loadState() {
  const store = getStore({ name: 'raspa-primera', consistency: 'strong' });
  let st = await store.get(KEY, { type: 'json' });
  if (!st) st = { series: newSeries(1), players: {}, hist: [] };
  if (st.series.pos >= PER_SERIES || st.series.outcomes.length !== PER_SERIES || st.series.v !== 2) st.series = newSeries(st.series.num + 1);
  return { st, save: () => store.setJSON(KEY, st) };
}

function publicPlayer(p) {
  return { name: p.name, intentos: p.intentos, pts: p.pts, jugados: p.jugados, ganados: p.ganados ?? p.pts, precioCanje: PRECIO_CANJE };
}

function ranking(st) {
  return Object.values(st.players)
    .map(p => ({ name: p.name, pts: p.ganados ?? p.pts }))
    .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

function cleanCode(c) {
  return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}


// Entrar con el código: devuelve datos del jugador, tabla de premios y ranking
async function jugador(req) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const { code } = await readBody(req);
  const { st } = await loadState();
  const p = st.players[cleanCode(code)];
  if (!p) return json({ error: 'Ese código no existe. Revisalo o pedile uno nuevo al creador.' }, 404);
  return json({ jugador: publicPlayer(p), tabla: playerTable(), ranking: ranking(st) });
};



// Jugar un cartón: el resultado se decide en el servidor, el celular solo lo muestra
async function jugar(req) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const { code } = await readBody(req);
  const { st, save } = await loadState();
  const key = cleanCode(code);
  const p = st.players[key];
  if (!p) return json({ error: 'Ese código no existe.' }, 404);
  if (p.intentos < 1) return json({ error: 'No te quedan intentos. Pedile más al creador.' }, 400);

  if (st.series.pos >= PER_SERIES) st.series = newSeries(st.series.num + 1);
  const nro = st.series.pos++;
  const win = st.series.outcomes[nro];
  const cells = makeCells(win);

  p.intentos -= 1;
  p.jugados += 1;
  let premio = null;
  if (win >= 0) {
    const c = CLUBS[win];
    if (c.free) { p.intentos += 1; premio = { id: c.id, name: c.name, free: true }; }
    else { p.ganados = (p.ganados ?? p.pts) + c.pts; p.pts += c.pts; premio = { id: c.id, name: c.name, pts: c.pts }; }
  }

  st.hist.unshift({ code: key, name: p.name, serie: st.series.num, nro: nro + 1, premio, ts: Date.now() });
  st.hist = st.hist.slice(0, 200);
  await save();

  return json({
    carton: { serie: st.series.num, nro: nro + 1, cells, premio },
    jugador: publicPlayer(p),
    tabla: playerTable(),
    ranking: ranking(st)
  });
}

// Canjear puntos por cartones, sin intervención del creador
async function canjear(req) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const body = await readBody(req);
  const { st, save } = await loadState();
  const key = cleanCode(body.code);
  const p = st.players[key];
  if (!p) return json({ error: 'Ese código no existe.' }, 404);
  const max = Math.floor(p.pts / PRECIO_CANJE);
  const cant = body.todo ? max : Math.max(1, parseInt(body.cantidad, 10) || 1);
  if (max < 1 || cant > max) return json({ error: `Necesitás ${PRECIO_CANJE} puntos por cartón.` }, 400);
  if (p.ganados === undefined) p.ganados = p.pts;
  p.pts -= cant * PRECIO_CANJE;
  p.intentos += cant;
  p.canjeados = (p.canjeados || 0) + cant;
  st.hist.unshift({ code: key, name: p.name, canje: cant, ts: Date.now() });
  st.hist = st.hist.slice(0, 200);
  await save();
  return json({ canjeados: cant, jugador: publicPlayer(p), tabla: playerTable(), ranking: ranking(st) });
};



const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function nuevoCodigo(players) {
  let c;
  do { c = Array.from({ length: 6 }, () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]).join(''); }
  while (players[c]);
  return c;
}

function resumen(st) {
  return {
    jugadores: Object.entries(st.players)
      .map(([code, p]) => ({ code, ...p }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    tabla: prizeTable(st),
    hist: st.hist.slice(0, 60)
  };
}

// Panel del creador: protegido con la contraseña ADMIN_PASSWORD configurada en Netlify
async function admin(req) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const pw = (globalThis.Netlify?.env?.get('ADMIN_PASSWORD')) || process.env.ADMIN_PASSWORD;
  if (!pw) return json({ error: 'Falta configurar ADMIN_PASSWORD en Netlify (ver la guía).' }, 500);

  const body = await readBody(req);
  if (body.password !== pw) return json({ error: 'Contraseña incorrecta.' }, 401);

  const { st, save } = await loadState();
  const n = v => Math.max(-999, Math.min(999, parseInt(v, 10) || 0));

  switch (body.action) {
    case 'estado':
      break;
    case 'crear': {
      const name = String(body.nombre || '').trim().slice(0, 20);
      if (!name) return json({ error: 'Escribí un nombre.' }, 400);
      const code = nuevoCodigo(st.players);
      st.players[code] = { name, intentos: Math.max(0, n(body.intentos)), pts: 0, jugados: 0 };
      await save();
      break;
    }
    case 'sumar': {
      const p = st.players[cleanCode(body.code)];
      if (!p) return json({ error: 'Jugador no encontrado.' }, 404);
      p.intentos = Math.max(0, p.intentos + n(body.cantidad));
      await save();
      break;
    }
    case 'sumarTodos': {
      Object.values(st.players).forEach(p => { p.intentos = Math.max(0, p.intentos + n(body.cantidad)); });
      await save();
      break;
    }
    case 'borrar': {
      delete st.players[cleanCode(body.code)];
      await save();
      break;
    }
    case 'reiniciarPuntos': {
      Object.values(st.players).forEach(p => { p.pts = 0; p.jugados = 0; p.ganados = 0; p.canjeados = 0; });
      st.hist = [];
      await save();
      break;
    }
    case 'nuevaSerie': {
      st.series = newSeries(st.series.num + 1);
      await save();
      break;
    }
    default:
      return json({ error: 'Acción desconocida.' }, 400);
  }
  return json(resumen(st));
};


// Una sola función atiende las tres direcciones
export default async (req) => {
  const p = new URL(req.url).pathname;
  if (p.endsWith('/jugador')) return jugador(req);
  if (p.endsWith('/jugar')) return jugar(req);
  if (p.endsWith('/canjear')) return canjear(req);
  if (p.endsWith('/admin')) return admin(req);
  return json({ error: 'No encontrado' }, 404);
};

export const config = { path: ['/api/jugador', '/api/jugar', '/api/canjear', '/api/admin'] };
