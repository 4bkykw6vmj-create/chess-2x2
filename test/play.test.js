// Сквозной тест: сервер + несколько WebSocket-клиентов. Запуск: node test/play.test.js
const assert = require('assert');
const { start } = require('../server.js');

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, state: null, you: null, errors: [], waiters: [] };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'state') { c.state = m.room; c.you = m.you; }
    if (m.t === 'error') c.errors.push(m.code);
    c.waiters = c.waiters.filter((w) => !w(m));
  };
  c.send = (o) => ws.send(JSON.stringify(o));
  c.next = (pred, label) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout: ' + label)), 3000);
    c.waiters.push((m) => { if (pred(m)) { clearTimeout(t); res(m); return true; } return false; });
  });
  c.opened = new Promise((r) => { ws.onopen = r; });
  return c;
}
const isState = (fn) => (m) => m.t === 'state' && fn(m.room);
const token = (n) => ('test-token-' + n).padEnd(24, 'x');

(async () => {
  const server = await start(0, { dataFile: null });
  const port = server.address().port;
  const room = 'tst' + Math.random().toString(36).slice(2, 7);
  const [A, B, C, D] = [1, 2, 3, 4].map(() => client(port));
  await Promise.all([A, B, C, D].map((c) => c.opened));

  // Вход и рассадка: A=w1, B=b1, C=w2, D=b2
  const names = ['Аня', 'Боря', 'Вика', 'Гоша'];
  for (const [i, c] of [A, B, C, D].entries()) {
    c.send({ t: 'join', room, token: token(i), name: names[i] });
    await c.next((m) => m.t === 'state', 'join');
  }
  A.send({ t: 'sit', seat: 'w1' }); await A.next(isState((r) => r.seats.w1), 'sit w1');
  assert.strictEqual(A.state.status, 'waiting');
  B.send({ t: 'sit', seat: 'b1' }); await B.next(isState((r) => r.seats.b1), 'sit b1');
  C.send({ t: 'sit', seat: 'w2' }); await C.next(isState((r) => r.seats.w2), 'sit w2');
  D.send({ t: 'sit', seat: 'b2' }); await D.next(isState((r) => r.seats.b2 && r.status === 'playing'), 'sit b2');
  assert.strictEqual(D.state.players[D.state.seats.w1].name, 'Аня');
  // Занятое место не отдают
  D.send({ t: 'sit', seat: 'w1' }); await D.next((m) => m.t === 'error' && m.code === 'seat_taken', 'seat_taken');

  // Порядок ходов w1, b1, w2, b2 + проверка «не твой ход» и нелегального хода
  assert.strictEqual(A.state.turnSeat, 'w1');
  C.send({ t: 'move', from: 'e2', to: 'e4' }); await C.next((m) => m.t === 'error' && m.code === 'not_your_turn', 'not your turn');
  A.send({ t: 'move', from: 'e2', to: 'e5' }); await A.next((m) => m.t === 'error' && m.code === 'illegal_move', 'illegal');

  const plan = [[A, 'e2', 'e4', 'b1'], [B, 'e7', 'e5', 'w2'], [C, 'd1', 'h5', 'b2'], [D, 'b8', 'c6', 'w1'],
    [A, 'f1', 'c4', 'b1'], [B, 'g8', 'f6', 'w2'], [C, 'h5', 'f7', null]];
  for (const [who, from, to, nextSeat] of plan) {
    who.send({ t: 'move', from, to });
    const m = await who.next(isState((r) => r.moves.length && r.moves[r.moves.length - 1].to === to), 'move ' + to);
    assert.strictEqual(m.room.turnSeat, nextSeat, 'после ' + to);
  }
  assert.strictEqual(C.state.status, 'finished');
  assert.deepStrictEqual(C.state.result, { winner: 'w', reason: 'checkmate' });
  assert.strictEqual(C.state.moves[6].san, 'Qxf7#');
  assert.strictEqual(C.state.moves[6].seat, 'w2');

  // Зритель, пришедший позже, сразу видит всю партию
  const E = client(port); await E.opened;
  E.send({ t: 'join', room, token: token(9), name: 'Зритель' });
  await E.next((m) => m.t === 'state', 'late join');
  assert.strictEqual(E.state.moves.length, 7);
  assert.strictEqual(E.state.watchers, 1);
  E.send({ t: 'resign' }); await E.next((m) => m.t === 'error', 'watcher cannot resign');

  // Реванш: цвета меняются, ходов нет
  const aPid = A.you;
  B.send({ t: 'newgame' });
  await A.next(isState((r) => r.game === 2), 'newgame');
  assert.strictEqual(A.state.seats.b1, aPid);
  assert.strictEqual(A.state.moves.length, 0);
  assert.strictEqual(A.state.turnSeat, 'w1');

  // Отключение и возвращение на своё место
  A.ws.close();
  await B.next(isState((r) => r.players[aPid] && !r.players[aPid].online), 'A offline');
  const A2 = client(port); await A2.opened;
  A2.send({ t: 'join', room, token: token(0) });
  const back = await A2.next((m) => m.t === 'state', 'A back');
  assert.strictEqual(back.room.seats.b1, aPid);
  assert.strictEqual(back.room.players[aPid].online, true);
  assert.strictEqual(back.room.players[aPid].name, 'Аня');

  // Один игрок на стороне ходит за неё всегда
  D.send({ t: 'stand' }); await D.next(isState((r) => !r.seats.w2), 'stand');
  B.send({ t: 'move', from: 'e2', to: 'e4' }); await B.next(isState((r) => r.moves.length === 1), 'w move');
  // за чёрных теперь ходит b1 (A2), b2 — C
  A2.send({ t: 'move', from: 'e7', to: 'e5' }); await A2.next(isState((r) => r.moves.length === 2), 'b move');
  assert.strictEqual(A2.state.turnSeat, 'w1');
  B.send({ t: 'move', from: 'g1', to: 'f3' }); await B.next(isState((r) => r.moves.length === 3), 'w again');
  assert.strictEqual(B.state.turnSeat, 'b2');
  // Сдача
  C.send({ t: 'resign' });
  await B.next(isState((r) => r.result), 'resign');
  assert.deepStrictEqual({ w: B.state.result.winner, r: B.state.result.reason }, { w: 'w', r: 'resign' });

  // Мусор не роняет сервер
  B.ws.send('не json'); B.send({ t: 'move', from: 123, to: null }); B.send({ t: 'join', room: '../../etc' });
  await new Promise((r) => setTimeout(r, 200));
  const F = client(port); await F.opened;
  F.send({ t: 'join', room, token: token(10) });
  await F.next((m) => m.t === 'state', 'still alive');

  console.log('play ok');
  for (const c of [A2, B, C, D, E, F]) c.ws.close();
  server.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
