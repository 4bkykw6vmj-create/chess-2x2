#!/bin/bash
# Двойной клик: запускает сервер игры и даёт публичную ссылку для друзей.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "=============================================="
echo "        Шахматы 2 на 2 — запуск"
echo "=============================================="

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Не найден Node.js. Сейчас откроется сайт nodejs.org:"
  echo "скачайте версию LTS, установите и снова дважды нажмите на этот файл."
  open "https://nodejs.org/"
  read -r -p "Нажмите Enter, чтобы закрыть окно..."
  exit 1
fi

PORT=3000
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done

PORT=$PORT node server.js &
SERVER_PID=$!
caffeinate -dimsu -w $SERVER_PID &   # не даём Mac уснуть, пока работает сервер
LOG="$(mktemp -t chess22)"
cleanup() { kill $SERVER_PID $TUNNEL_PID 2>/dev/null; rm -f "$LOG"; }
trap cleanup EXIT INT TERM
sleep 1

echo
echo "Сервер запущен: http://localhost:$PORT"
echo "Делаю публичную ссылку для друзей (localhost.run)..."

ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
    -R 80:localhost:$PORT nokey@localhost.run > "$LOG" 2>&1 &
TUNNEL_PID=$!

URL=""
for _ in $(seq 1 30); do
  URL=$(grep -Eo 'https://[a-zA-Z0-9.-]+\.(lhr\.life|localhost\.run)' "$LOG" | grep -v 'admin.localhost.run' | head -1)
  [ -n "$URL" ] && break
  sleep 1
done

echo
if [ -n "$URL" ]; then
  printf "%s" "$URL" | pbcopy
  echo "ГОТОВО! Ссылка для друзей (уже скопирована):"
  echo
  echo "    $URL"
  echo
  echo "Открываю игру в браузере. Нажмите «Создать игру»,"
  echo "затем «Скопировать ссылку» и отправьте её друзьям."
  open "$URL"
else
  echo "Публичную ссылку получить не удалось (нет интернета или localhost.run недоступен)."
  echo "Играть можно с этого компьютера и из той же Wi-Fi сети:"
  IP=$(ipconfig getifaddr en0 2>/dev/null)
  echo "    http://localhost:$PORT"
  [ -n "$IP" ] && echo "    http://$IP:$PORT   (для телефонов в этой же Wi-Fi)"
  open "http://localhost:$PORT"
fi
echo
echo "Не закрывайте это окно, пока играете. Чтобы остановить — закройте окно."
wait $SERVER_PID
