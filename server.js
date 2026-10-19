// Шахматы 2 на 2 — сервер без зависимостей: http + WebSocket + комнаты.
// Запуск: node server.js   (порт из переменной PORT, по умолчанию 3000)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Chess } = require('./public/rules.js');

const PUBLIC = path.join(__dirname, 'public');
const SEATS = ['w1', 'w2', 'b1', 'b2'];
const ROOM_TTL = 48 * 3600 * 1000;
const MAX_ROOMS = 5000;

// ---------- WebSocket (RFC 6455, минимально необходимое) ----------

function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const ws = { socket, alive: true, open: true, onmessage: null, onclose: null };
  let buf = Buffer.alloc(0), fragments = [];

  ws.send = (text) => {
    if (!ws.open) return;
    const data = Buffer.from(text);
    let head;
    if (data.length < 126) head = Buffer.from([0x81, data.length]);
    else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
    socket.write(Buffer.concat([head, data]));
  };
  ws.control = (opcode, payload = Buffer.alloc(0)) => {
    if (ws.open) socket.write(Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]));
  };
  ws.close = () => {
    if (!ws.open) return;
    ws.control(0x8);
    ws.open = false;
    socket.end();
    setTimeout(() => socket.destroy(), 1000).unref();
  };

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, opcode = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 65536 || !masked) { ws.close(); return; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (opcode === 0x8) { ws.close(); return; }
      if (opcode === 0x9) { ws.control(0xA, payload.subarray(0, 125)); continue; }
      if (opcode === 0xA) { ws.alive = true; continue; }
      if (opcode === 0x1 || opcode === 0x0) {
        fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(fragments).toString('utf8');
          fragments = [];
          if (ws.onmessage) ws.onmessage(text);
        }
      }
    }
  });
  const done = () => { if (ws.closed) return; ws.closed = true; ws.open = false; if (ws.onclose) ws.onclose(); };
  socket.on('close', done);
  socket.on('error', done);
  return ws;
}

// ---------- Комнаты ----------

const rooms = new Map();    // id -> room
const sockets = new Map();  // id -> Set<ws>
const games = new Map();    // id -> Chess (восстанавливается из списка ходов)
let dataFile = null, saveTimer = null;

function publicId(token) { return crypto.createHash('sha256').update('p:' + token).digest('hex').slice(0, 12); }
function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) || 'Игрок';
}

function newRoom(id) {
  const now = Date.now();
  return {
    id, createdAt: now, updatedAt: now,
    moves: [], seats: { w1: null, w2: null, b1: null, b2: null },
    players: {}, result: null, game: 1
  };
}

function gameOf(room) {
  let g = games.get(room.id);
  if (!g) {
    g = new Chess();
    for (const m of room.moves) g.move({ from: m.from, to: m.to, promotion: m.promotion });
    games.set(room.id, g);
  }
  return g;
}

function sideHas(room, side) { return !!(room.seats[side + '1'] || room.seats[side + '2']); }
function status(room) {
  if (room.result) return 'finished';
  return sideHas(room, 'w') && sideHas(room, 'b') ? 'playing' : 'waiting';
}

// Чей ход: партнёры чередуются (w1, b1, w2, b2 …); если на стороне один игрок — он ходит всегда.
function expectedSeat(room) {
  const side = gameOf(room).turn();
  const n = room.moves.filter((m) => m.side === side).length;
  const first = side + (n % 2 === 0 ? '1' : '2');
  const second = side + (n % 2 === 0 ? '2' : '1');
  return room.seats[first] ? first : room.seats[second] ? second : null;
}

function snapshot(room) {
  const g = gameOf(room);
  const conn = sockets.get(room.id) || new Set();
  const online = new Set([...conn].map((ws) => ws.pid));
  const seated = new Set(Object.values(room.seats).filter(Boolean));
  const players = {};
  for (const [pid, p] of Object.entries(room.players)) {
    if (seated.has(pid) || online.has(pid)) players[pid] = { name: p.name, online: online.has(pid) };
  }
  return {
    id: room.id, game: room.game, fen: g.fen(), turn: g.turn(), inCheck: g.inCheck(),
    moves: room.moves.map((m) => ({ from: m.from, to: m.to, san: m.san, side: m.side, seat: m.seat, pid: m.pid })),
    seats: room.seats, players, status: status(room), result: room.result,
    turnSeat: room.result ? null : expectedSeat(room),
    watchers: [...online].filter((pid) => !seated.has(pid)).length
  };
}

function broadcast(room) {
  room.updatedAt = Date.now();
  const snap = snapshot(room);
  for (const ws of sockets.get(room.id) || []) ws.send(JSON.stringify({ t: 'state', room: snap, you: ws.pid }));
  scheduleSave();
}

function sendError(ws, code, msg) { ws.send(JSON.stringify({ t: 'error', code, msg })); }

function seatOf(room, pid) { return SEATS.find((s) => room.seats[s] === pid) || null; }

function handle(ws, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return sendError(ws, 'bad_request', 'Непонятное сообщение');

  if (msg.t === 'join') {
    const id = String(msg.room || '').toLowerCase();
    const token = String(msg.token || '');
    if (!/^[a-z0-9]{4,12}$/.test(id) || token.length < 16 || token.length > 64) return sendError(ws, 'bad_request', 'Неверный код комнаты');
    let room = rooms.get(id);
    if (!room) {
      if (rooms.size >= MAX_ROOMS) return sendError(ws, 'bad_request', 'Сервер переполнен, попробуйте позже');
      room = newRoom(id);
      rooms.set(id, room);
    }
    if (ws.roomId && ws.roomId !== id) leave(ws);
    ws.roomId = id;
    ws.pid = publicId(token);
    const p = room.players[ws.pid] || (room.players[ws.pid] = { name: 'Игрок' });
    if (msg.name) p.name = cleanName(msg.name);
    if (!sockets.has(id)) sockets.set(id, new Set());
    sockets.get(id).add(ws);
    return broadcast(room);
  }

  const room = rooms.get(ws.roomId);
  if (!room) return sendError(ws, 'bad_request', 'Сначала войдите в комнату');
  const pid = ws.pid;
  const mySeat = seatOf(room, pid);

  switch (msg.t) {
    case 'sit': {
      if (!SEATS.includes(msg.seat)) return sendError(ws, 'bad_request', 'Нет такого места');
      if (room.seats[msg.seat] && room.seats[msg.seat] !== pid) return sendError(ws, 'seat_taken', 'Место уже занято');
      if (mySeat) room.seats[mySeat] = null;
      room.seats[msg.seat] = pid;
      return broadcast(room);
    }
    case 'stand': {
      if (mySeat) room.seats[mySeat] = null;
      return broadcast(room);
    }
    case 'rename': {
      room.players[pid].name = cleanName(msg.name);
      return broadcast(room);
    }
    case 'move': {
      if (room.result) return sendError(ws, 'game_over', 'Партия окончена');
      if (status(room) !== 'playing') return sendError(ws, 'not_your_turn', 'Ждём игроков за обеими сторонами');
      const turnSeat = expectedSeat(room);
      if (!turnSeat || room.seats[turnSeat] !== pid) return sendError(ws, 'not_your_turn', 'Сейчас не ваш ход');
      const g = gameOf(room);
      const promotion = ['q', 'r', 'b', 'n'].includes(msg.promotion) ? msg.promotion : undefined;
      const side = g.turn();
      const m = g.move({ from: String(msg.from), to: String(msg.to), promotion });
      if (!m) return sendError(ws, 'illegal_move', 'Так ходить нельзя');
      room.moves.push({ from: m.from, to: m.to, promotion: m.promotion, san: m.san, side, seat: turnSeat, pid, ts: Date.now() });
      const out = g.outcome();
      if (out) room.result = out;
      return broadcast(room);
    }
    case 'resign': {
      if (room.result) return sendError(ws, 'game_over', 'Партия уже окончена');
      if (!mySeat) return sendError(ws, 'bad_request', 'Сдаться может только игрок');
      if (status(room) !== 'playing') return sendError(ws, 'bad_request', 'Партия ещё не началась');
      room.result = { winner: mySeat[0] === 'w' ? 'b' : 'w', reason: 'resign', by: pid };
      return broadcast(room);
    }
    case 'newgame': {
      if (!mySeat) return sendError(ws, 'bad_request', 'Начать новую партию может только игрок');
      const s = room.seats;
      room.seats = { w1: s.b1, w2: s.b2, b1: s.w1, b2: s.w2 };
      room.moves = [];
      room.result = null;
      room.game += 1;
      games.delete(room.id);
      return broadcast(room);
    }
    default:
      return sendError(ws, 'bad_request', 'Неизвестная команда');
  }
}

function leave(ws) {
  const set = sockets.get(ws.roomId);
  if (!set) return;
  set.delete(ws);
  const room = rooms.get(ws.roomId);
  if (room) broadcast(room);
}

// ---------- Сохранение на диск ----------

function scheduleSave() {
  if (!dataFile || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = dataFile + '.tmp';
    fs.writeFile(tmp, JSON.stringify([...rooms.values()]), (err) => {
      if (!err) fs.rename(tmp, dataFile, () => {});
    });
  }, 1000);
}

function load() {
  try {
    const list = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    for (const r of list) if (Date.now() - r.updatedAt < ROOM_TTL) rooms.set(r.id, r);
  } catch (e) { /* файла ещё нет */ }
}

function cleanup() {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (now - r.updatedAt > ROOM_TTL && !(sockets.get(id) || new Set()).size) {
      rooms.delete(id); games.delete(id); sockets.delete(id);
    }
  }
  scheduleSave();
}

// ---------- HTTP ----------

function sendFile(res, file, type, cache) {
  fs.readFile(path.join(PUBLIC, file), (err, data) => {
    if (err) { res.writeHead(500); return res.end('error'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
    res.end(data);
  });
}

function start(port, opts = {}) {
  dataFile = opts.dataFile === undefined ? path.join(__dirname, 'data', 'rooms.json') : opts.dataFile;
  if (dataFile) { fs.mkdirSync(path.dirname(dataFile), { recursive: true }); load(); }

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || /^\/r\/[a-z0-9]{4,12}\/?$/i.test(url)) return sendFile(res, 'index.html', 'text/html; charset=utf-8', 'no-store');
    if (url === '/rules.js') return sendFile(res, 'rules.js', 'application/javascript; charset=utf-8', 'no-cache');
    if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
  });

  server.on('upgrade', (req, socket) => {
    if ((req.url || '').split('?')[0] !== '/ws') return socket.destroy();
    const ws = wsAccept(req, socket);
    if (!ws) return;
    let budget = 20; // не больше ~20 сообщений в секунду
    const refill = setInterval(() => { budget = 20; }, 1000);
    ws.onmessage = (text) => {
      if (--budget < 0) return;
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return sendError(ws, 'bad_request', 'Не JSON'); }
      try { handle(ws, msg); } catch (e) { console.error(e); sendError(ws, 'bad_request', 'Ошибка сервера'); }
    };
    ws.onclose = () => { clearInterval(refill); leave(ws); };
    allSockets.add(ws);
    socket.on('close', () => allSockets.delete(ws));
  });

  const allSockets = new Set();
  const ping = setInterval(() => {
    for (const ws of allSockets) {
      if (!ws.alive) { ws.socket.destroy(); continue; }
      ws.alive = false;
      ws.control(0x9);
    }
  }, 30000);
  const clean = setInterval(cleanup, 3600 * 1000);
  ping.unref(); clean.unref();

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

module.exports = { start };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  start(port).then(() => console.log('Шахматы 2 на 2: http://localhost:' + port));
}
