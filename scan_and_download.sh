#!/bin/bash
set -e

BASE_URL="http://127.0.0.1:8000"

echo "▶ Starting scan..."
SESSION=$(curl -s -X POST -d '' -H 'accept: application/json' "$BASE_URL/scan/start" | jq .session_id | sed 's/"//g')
echo "  Session: $SESSION"

echo "⏳ Waiting for scan to finish (auto or manual)..."
while true; do
  STATE=$(curl -s "$BASE_URL/scan/$SESSION/status" | jq -r .state)
  echo "  State: $STATE"

  if [ "$STATE" = "finished" ]; then
    break
  elif [ "$STATE" = "error" ] || [ "$STATE" = "cancelled" ]; then
    echo "✗ Session ended with state: $STATE"
    exit 1
  fi

  sleep 2
done

echo "⬇ Downloading PDF..."
curl -s -OJ "$BASE_URL/scan/$SESSION/download"

echo "🧹 Cleaning up..."
curl -s -X DELETE "$BASE_URL/scan/$SESSION"

echo "✅ Done!"
