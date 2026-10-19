/* Шахматные правила без зависимостей. Работает и в Node (require), и в браузере (window.Chess).
 * Доска: массив из 64 клеток, индекс = ряд*8 + вертикаль, a1 = 0, h8 = 63.
 * Фигура: строка из цвета и типа, например 'wP', 'bK'; пустая клетка — null. */
(function (root) {
  'use strict';

  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var FILES = 'abcdefgh';
  var KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function sqIndex(name) {
    if (typeof name !== 'string' || !/^[a-h][1-8]$/.test(name)) return -1;
    return (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
  }
  function sqName(i) { return FILES[i & 7] + ((i >> 3) + 1); }
  function other(c) { return c === 'w' ? 'b' : 'w'; }
  function at(f, r) { return (f >= 0 && f < 8 && r >= 0 && r < 8) ? r * 8 + f : -1; }

  function parseFen(fen) {
    var p = String(fen).trim().split(/\s+/);
    var rows = (p[0] || '').split('/');
    if (rows.length !== 8) throw new Error('bad fen');
    var board = new Array(64).fill(null);
    for (var r = 0; r < 8; r++) {
      var f = 0;
      for (var k = 0; k < rows[r].length; k++) {
        var ch = rows[r][k];
        if (ch >= '1' && ch <= '8') { f += +ch; continue; }
        if ('pnbrqkPNBRQK'.indexOf(ch) < 0 || f > 7) throw new Error('bad fen');
        board[(7 - r) * 8 + f] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
        f++;
      }
      if (f !== 8) throw new Error('bad fen');
    }
    var cas = p[2] && p[2] !== '-' ? p[2] : '';
    return {
      board: board,
      turn: p[1] === 'b' ? 'b' : 'w',
      castling: { K: cas.indexOf('K') >= 0, Q: cas.indexOf('Q') >= 0, k: cas.indexOf('k') >= 0, q: cas.indexOf('q') >= 0 },
      ep: p[3] && p[3] !== '-' ? sqIndex(p[3]) : -1,
      half: parseInt(p[4], 10) || 0,
      full: parseInt(p[5], 10) || 1
    };
  }

  function placement(board) {
    var out = [];
    for (var r = 7; r >= 0; r--) {
      var row = '', empty = 0;
      for (var f = 0; f < 8; f++) {
        var pc = board[r * 8 + f];
        if (!pc) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += pc[0] === 'w' ? pc[1] : pc[1].toLowerCase();
      }
      if (empty) row += empty;
      out.push(row);
    }
    return out.join('/');
  }
  function castlingStr(c) {
    var s = (c.K ? 'K' : '') + (c.Q ? 'Q' : '') + (c.k ? 'k' : '') + (c.q ? 'q' : '');
    return s || '-';
  }
  // Поле взятия на проходе показываем, только если такое взятие вообще возможно (для FEN и повторений).
  function epStr(s) {
    if (s.ep < 0) return '-';
    var dir = s.turn === 'w' ? -1 : 1; // откуда бьют: свои пешки стоят на ряд «ниже» поля ep
    var f = s.ep & 7, r = (s.ep >> 3) + dir;
    var pawn = s.turn + 'P';
    if ((f > 0 && s.board[at(f - 1, r)] === pawn) || (f < 7 && s.board[at(f + 1, r)] === pawn)) return sqName(s.ep);
    return '-';
  }
  function toFen(s) {
    return [placement(s.board), s.turn, castlingStr(s.castling), epStr(s), s.half, s.full].join(' ');
  }
  function posKey(s) { return [placement(s.board), s.turn, castlingStr(s.castling), epStr(s)].join(' '); }

  // Атакует ли сторона `by` клетку i
  function attacked(board, i, by) {
    var f = i & 7, r = i >> 3, j, k, d;
    var pr = by === 'w' ? r - 1 : r + 1; // пешка атакующего стоит на ряд ближе к своему краю
    j = at(f - 1, pr); if (j >= 0 && board[j] === by + 'P') return true;
    j = at(f + 1, pr); if (j >= 0 && board[j] === by + 'P') return true;
    for (k = 0; k < 8; k++) {
      j = at(f + KNIGHT[k][0], r + KNIGHT[k][1]); if (j >= 0 && board[j] === by + 'N') return true;
      j = at(f + KING[k][0], r + KING[k][1]); if (j >= 0 && board[j] === by + 'K') return true;
    }
    for (k = 0; k < 4; k++) {
      d = DIAG[k];
      for (var ff = f + d[0], rr = r + d[1]; (j = at(ff, rr)) >= 0; ff += d[0], rr += d[1]) {
        if (board[j]) { if (board[j] === by + 'B' || board[j] === by + 'Q') return true; break; }
      }
      d = ORTH[k];
      for (ff = f + d[0], rr = r + d[1]; (j = at(ff, rr)) >= 0; ff += d[0], rr += d[1]) {
        if (board[j]) { if (board[j] === by + 'R' || board[j] === by + 'Q') return true; break; }
      }
    }
    return false;
  }

  function kingSquare(board, c) { return board.indexOf(c + 'K'); }
  function inCheck(s) { var k = kingSquare(s.board, s.turn); return k >= 0 && attacked(s.board, k, other(s.turn)); }

  // Флаги: n — обычный, c — взятие, b — пешка на два поля, e — на проходе, k/q — рокировки, p — превращение (вместе с n/c)
  function pseudoMoves(s) {
    var b = s.board, c = s.turn, them = other(c), moves = [];
    function add(from, to, flags, promo) {
      moves.push({ from: from, to: to, flags: flags, promotion: promo || null });
    }
    for (var i = 0; i < 64; i++) {
      var pc = b[i];
      if (!pc || pc[0] !== c) continue;
      var t = pc[1], f = i & 7, r = i >> 3, j, k;
      if (t === 'P') {
        var dir = c === 'w' ? 1 : -1, startR = c === 'w' ? 1 : 6, lastR = c === 'w' ? 7 : 0;
        j = at(f, r + dir);
        if (j >= 0 && !b[j]) {
          if (r + dir === lastR) ['q', 'r', 'b', 'n'].forEach(function (p) { add(i, j, 'np', p); });
          else {
            add(i, j, 'n');
            var j2 = at(f, r + 2 * dir);
            if (r === startR && !b[j2]) add(i, j2, 'b');
          }
        }
        [-1, 1].forEach(function (df) {
          var x = at(f + df, r + dir);
          if (x < 0) return;
          if (b[x] && b[x][0] === them) {
            if (r + dir === lastR) ['q', 'r', 'b', 'n'].forEach(function (p) { add(i, x, 'cp', p); });
            else add(i, x, 'c');
          } else if (x === s.ep && !b[x]) add(i, x, 'e');
        });
      } else if (t === 'N' || t === 'K') {
        var offs = t === 'N' ? KNIGHT : KING;
        for (k = 0; k < 8; k++) {
          j = at(f + offs[k][0], r + offs[k][1]);
          if (j < 0) continue;
          if (!b[j]) add(i, j, 'n'); else if (b[j][0] === them) add(i, j, 'c');
        }
      } else {
        var dirs = t === 'B' ? DIAG : t === 'R' ? ORTH : DIAG.concat(ORTH);
        for (k = 0; k < dirs.length; k++) {
          for (var ff = f + dirs[k][0], rr = r + dirs[k][1]; (j = at(ff, rr)) >= 0; ff += dirs[k][0], rr += dirs[k][1]) {
            if (!b[j]) { add(i, j, 'n'); continue; }
            if (b[j][0] === them) add(i, j, 'c');
            break;
          }
        }
      }
    }
    // Рокировки
    var home = c === 'w' ? 0 : 56, cs = s.castling, kSide = c === 'w' ? cs.K : cs.k, qSide = c === 'w' ? cs.Q : cs.q;
    if (b[home + 4] === c + 'K' && (kSide || qSide) && !attacked(b, home + 4, them)) {
      if (kSide && b[home + 7] === c + 'R' && !b[home + 5] && !b[home + 6] &&
          !attacked(b, home + 5, them) && !attacked(b, home + 6, them)) add(home + 4, home + 6, 'k');
      if (qSide && b[home] === c + 'R' && !b[home + 1] && !b[home + 2] && !b[home + 3] &&
          !attacked(b, home + 3, them) && !attacked(b, home + 2, them)) add(home + 4, home + 2, 'q');
    }
    return moves;
  }

  function applyMove(s, m) {
    var b = s.board.slice(), c = s.turn, pc = b[m.from], captured = b[m.to];
    var dir = c === 'w' ? 1 : -1;
    b[m.to] = m.promotion ? c + m.promotion.toUpperCase() : pc;
    b[m.from] = null;
    if (m.flags === 'e') { captured = b[m.to - 8 * dir]; b[m.to - 8 * dir] = null; }
    if (m.flags === 'k') { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = null; }
    if (m.flags === 'q') { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = null; }
    var cs = { K: s.castling.K, Q: s.castling.Q, k: s.castling.k, q: s.castling.q };
    if (pc[1] === 'K') { if (c === 'w') { cs.K = cs.Q = false; } else { cs.k = cs.q = false; } }
    [m.from, m.to].forEach(function (x) {
      if (x === 0) cs.Q = false; if (x === 7) cs.K = false; if (x === 56) cs.q = false; if (x === 63) cs.k = false;
    });
    return {
      board: b,
      turn: other(c),
      castling: cs,
      ep: m.flags === 'b' ? m.from + 8 * dir : -1,
      half: (pc[1] === 'P' || captured) ? 0 : s.half + 1,
      full: c === 'b' ? s.full + 1 : s.full,
      captured: captured
    };
  }

  function legalMoves(s) {
    return pseudoMoves(s).filter(function (m) {
      var n = applyMove(s, m);
      var k = kingSquare(n.board, s.turn);
      return k >= 0 && !attacked(n.board, k, other(s.turn));
    });
  }

  function insufficient(board) {
    var minors = [], bishopsColors = [];
    for (var i = 0; i < 64; i++) {
      var pc = board[i];
      if (!pc || pc[1] === 'K') continue;
      if (pc[1] === 'P' || pc[1] === 'R' || pc[1] === 'Q') return false;
      minors.push(pc);
      if (pc[1] === 'B') bishopsColors.push(((i & 7) + (i >> 3)) % 2);
    }
    if (minors.length <= 1) return true;
    // Только слоны, и все на полях одного цвета
    return bishopsColors.length === minors.length && bishopsColors.every(function (x) { return x === bishopsColors[0]; });
  }

  function san(s, m, legal) {
    var pc = s.board[m.from], t = pc[1], out;
    if (m.flags === 'k') out = 'O-O';
    else if (m.flags === 'q') out = 'O-O-O';
    else {
      var capture = m.flags === 'e' || m.flags.indexOf('c') >= 0;
      if (t === 'P') {
        out = (capture ? FILES[m.from & 7] + 'x' : '') + sqName(m.to);
        if (m.promotion) out += '=' + m.promotion.toUpperCase();
      } else {
        var rivals = legal.filter(function (o) { return o.to === m.to && o.from !== m.from && s.board[o.from] === pc; });
        var dis = '';
        if (rivals.length) {
          var sameFile = rivals.some(function (o) { return (o.from & 7) === (m.from & 7); });
          var sameRank = rivals.some(function (o) { return (o.from >> 3) === (m.from >> 3); });
          if (!sameFile) dis = FILES[m.from & 7];
          else if (!sameRank) dis = String((m.from >> 3) + 1);
          else dis = sqName(m.from);
        }
        out = t + dis + (capture ? 'x' : '') + sqName(m.to);
      }
    }
    var n = applyMove(s, m);
    if (inCheck(n)) out += legalMoves(n).length ? '+' : '#';
    return out;
  }

  function Chess(fen) {
    this._s = parseFen(fen || START);
    this._keys = [posKey(this._s)];
    this._history = [];
  }
  Chess.prototype.fen = function () { return toFen(this._s); };
  Chess.prototype.turn = function () { return this._s.turn; };
  Chess.prototype.get = function (square) {
    var i = sqIndex(square); var pc = i >= 0 ? this._s.board[i] : null;
    return pc ? { color: pc[0], type: pc[1].toLowerCase() } : null;
  };
  Chess.prototype.board = function () { return this._s.board.slice(); };
  Chess.prototype._verbose = function (m, legal) {
    var pc = this._s.board[m.from];
    return {
      from: sqName(m.from), to: sqName(m.to), color: pc[0], piece: pc[1].toLowerCase(),
      flags: m.flags, promotion: m.promotion || undefined, san: san(this._s, m, legal),
      captured: m.flags === 'e' ? 'p' : (this._s.board[m.to] ? this._s.board[m.to][1].toLowerCase() : undefined)
    };
  };
  Chess.prototype.moves = function (opts) {
    opts = opts || {};
    var self = this, legal = legalMoves(this._s);
    var list = legal;
    if (opts.square) { var i = sqIndex(opts.square); list = legal.filter(function (m) { return m.from === i; }); }
    var verbose = list.map(function (m) { return self._verbose(m, legal); });
    return opts.verbose ? verbose : verbose.map(function (v) { return v.san; });
  };
  // move({from:'e2', to:'e4', promotion:'q'}) или move('e4'). Возвращает ход или null, если нелегально.
  Chess.prototype.move = function (input) {
    var legal = legalMoves(this._s), found = null, self = this;
    if (typeof input === 'string') {
      var clean = function (x) { return x.replace(/[+#?!]/g, ''); };
      found = legal.filter(function (m) { return clean(san(self._s, m, legal)) === clean(input); })[0] || null;
    } else if (input && typeof input === 'object') {
      var from = sqIndex(input.from), to = sqIndex(input.to);
      var promo = typeof input.promotion === 'string' ? input.promotion.toLowerCase() : null;
      var cands = legal.filter(function (m) { return m.from === from && m.to === to; });
      if (cands.length > 1) found = cands.filter(function (m) { return m.promotion === (promo || 'q'); })[0] || null;
      else found = cands[0] || null;
    }
    if (!found) return null;
    var v = this._verbose(found, legal);
    this._s = applyMove(this._s, found);
    this._keys.push(posKey(this._s));
    this._history.push(v);
    return v;
  };
  Chess.prototype.history = function (opts) {
    return opts && opts.verbose ? this._history.slice() : this._history.map(function (m) { return m.san; });
  };
  Chess.prototype.inCheck = function () { return inCheck(this._s); };
  Chess.prototype.isCheckmate = function () { return inCheck(this._s) && legalMoves(this._s).length === 0; };
  Chess.prototype.isStalemate = function () { return !inCheck(this._s) && legalMoves(this._s).length === 0; };
  Chess.prototype.isInsufficientMaterial = function () { return insufficient(this._s.board); };
  Chess.prototype.isThreefoldRepetition = function () {
    var last = this._keys[this._keys.length - 1];
    return this._keys.filter(function (k) { return k === last; }).length >= 3;
  };
  Chess.prototype.isFiftyMoves = function () { return this._s.half >= 100; };
  Chess.prototype.isDraw = function () {
    return this.isStalemate() || this.isInsufficientMaterial() || this.isThreefoldRepetition() || this.isFiftyMoves();
  };
  Chess.prototype.isGameOver = function () { return this.isCheckmate() || this.isDraw(); };
  // Причина окончания партии или null
  Chess.prototype.outcome = function () {
    if (this.isCheckmate()) return { winner: other(this._s.turn), reason: 'checkmate' };
    if (this.isStalemate()) return { winner: null, reason: 'stalemate' };
    if (this.isInsufficientMaterial()) return { winner: null, reason: 'material' };
    if (this.isThreefoldRepetition()) return { winner: null, reason: 'repetition' };
    if (this.isFiftyMoves()) return { winner: null, reason: 'fifty' };
    return null;
  };
  // Для perft-тестов
  Chess.perft = function (fen, depth) {
    function go(s, d) {
      if (d === 0) return 1;
      var ms = legalMoves(s);
      if (d === 1) return ms.length;
      var n = 0;
      for (var i = 0; i < ms.length; i++) n += go(applyMove(s, ms[i]), d - 1);
      return n;
    }
    return go(parseFen(fen), depth);
  };
  Chess.START = START;

  if (typeof module !== 'undefined' && module.exports) module.exports = { Chess: Chess, START: START };
  else root.Chess = Chess;
})(typeof window !== 'undefined' ? window : this);
