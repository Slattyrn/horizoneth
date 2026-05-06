#!/bin/bash
echo ""
echo "============================================"
echo "  Horizon Alpha Terminal - Starting..."
echo "============================================"
echo ""

DIR="$(dirname "$0")"
PY=$(command -v python3 || command -v python)

echo "[1/2] Starting backend on port 8001..."
cd "$DIR/backend"
$PY -m uvicorn main:app --host 0.0.0.0 --port 8001 &
BACKEND_PID=$!

sleep 3

echo "[2/2] Starting frontend on port 5174..."
cd "$DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8001"
echo "  Frontend: http://localhost:5174"
echo ""
echo "  Press Ctrl+C to stop both."
echo ""

trap "echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
