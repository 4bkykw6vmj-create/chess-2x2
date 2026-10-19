// Проверка правил: perft (эталонные числа позиций с chessprogramming.org) и концовки партии.
const assert = require('assert');
const { Chess, START } = require('../public/rules.js');

const perft = [
  [START, 1, 20], [START, 2, 400], [START, 3, 8902], [START, 4, 197281],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 1, 48],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2, 2039],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 5, 674624],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
  ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', 3, 89890],
];
for (const [fen, d, n] of perft) {
  const got = Chess.perft(fen, d);
  assert.strictEqual(got, n, `perft ${d} ${fen}: ${got} != ${n}`);
}
console.log('perft ok');

// Детский мат
let g = new Chess();
for (const m of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']) assert.ok(g.move(m), m);
assert.ok(g.isCheckmate());
assert.deepStrictEqual(g.outcome(), { winner: 'w', reason: 'checkmate' });
assert.strictEqual(g.history().join(' '), 'e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#');

// Пат
g = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
assert.ok(g.isStalemate() && g.isDraw());

// Недостаток материала
assert.ok(new Chess('8/8/8/4k3/8/8/8/4KB2 w - - 0 1').isInsufficientMaterial());
assert.ok(!new Chess('8/8/8/4k3/8/8/8/4KR2 w - - 0 1').isInsufficientMaterial());

// Троекратное повторение
g = new Chess();
for (const m of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) g.move(m);
assert.ok(g.isThreefoldRepetition());

// Превращение, рокировка, взятие на проходе, нелегальный ход
g = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
assert.strictEqual(g.move({ from: 'a7', to: 'a8', promotion: 'n' }).san, 'a8=N');
g = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
assert.strictEqual(g.move({ from: 'e1', to: 'g1' }).san, 'O-O');
assert.strictEqual(g.fen(), 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
g = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
assert.strictEqual(g.move({ from: 'e5', to: 'd6' }).san, 'exd6');
assert.strictEqual(g.get('d5'), null);
assert.strictEqual(new Chess().move({ from: 'e2', to: 'e5' }), null);
// Разрешение неоднозначности
g = new Chess('4k3/8/8/8/8/8/4K3/R6R w - - 0 1');
assert.ok(g.moves().includes('Rad1') && g.moves().includes('Rhd1'));
g = new Chess('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1');
assert.ok(g.moves().includes('R1a3') && g.moves().includes('R5a3'));
console.log('rules ok');
