# Horizon Eth — Workflow & Sync Rules (MGC / Micro Gold)

## What this is

A dedicated trading terminal for **MGC (Micro Gold Futures, COMEX)**.
Cloned from Horizon Alpha (MYM terminal) on 2026-04-28 and reconfigured for MGC.

**MYM terminal:** `C:\Users\lucsb\Downloads\horizon-alpha-terminal\` → GitHub: `Slattyrn/horizonalpha`
**MGC terminal:** `C:\Users\lucsb\Downloads\horizoneth\` → GitHub: `Slattyrn/horizoneth`

## Sync rule (for Claude)

**Every change must land in both places:**
1. Local working tree at `C:\Users\lucsb\Downloads\horizoneth\`
2. The GitHub repo at `https://github.com/Slattyrn/horizoneth.git`

When the user asks for any change to backend, frontend, or project files:
1. Make the edit in `horizoneth\` (live working copy)
2. `git add` → `git commit` → `git push` from inside `horizoneth\`
3. Confirm the push succeeded before reporting done

## Ports (different from MYM terminal to run both at once)

| Service | Port |
|---------|------|
| MGC backend (FastAPI) | **8001** |
| MGC frontend (Vite) | **5174** |
| MYM backend | 8000 |
| MYM frontend | 5173 |

## Per-machine setup (first time)

```bash
git clone https://github.com/Slattyrn/horizoneth.git
cd horizoneth

# Backend
cd backend
cp .env.example .env         # fill in PROJECTX_USERNAME, PROJECTX_API_KEY, PROJECTX_TOKEN
# DEFAULT_CONTRACT and MGC_CONTRACT are already set to CON.F.US.MGC.M26
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install

# Run (two terminals)
# Terminal A — MGC backend:
cd backend && uvicorn main:app --reload --port 8001
# Terminal B — MGC frontend:
cd frontend && npm run dev
```

## Running both terminals simultaneously

```
Terminal A: cd horizon-alpha-terminal/backend  && uvicorn main:app --reload --port 8000
Terminal B: cd horizon-alpha-terminal/frontend && npm run dev          (opens :5173)
Terminal C: cd horizoneth/backend             && uvicorn main:app --reload --port 8001
Terminal D: cd horizoneth/frontend            && npm run dev          (opens :5174)
```

## What is NOT in git (`.gitignore`)

- `.env` — real API keys/tokens
- `*.db` — candles.db market data (regenerates at runtime)
- `node_modules/` — regenerate with `npm install`
- `__pycache__/`, `*.pyc` — Python build artifacts
- `dist/`, `.vite/` — frontend build output

## MGC contract specs

| Field | Value |
|-------|-------|
| Contract | CON.F.US.MGC.M26 |
| Exchange | COMEX (CME Group) |
| Tick size | 0.1 point |
| Tick value | $1.00 per tick |
| Dollars/point | $10.00 |
| Price decimals | 1 (e.g. 3345.6) |

## Daily flow

```bash
cd horizoneth
git pull                                    # before starting
# ... make changes ...
git add <files>
git commit -m "description"
git push
```

## History

- 2026-04-28: Cloned from horizonalpha (MYM terminal), reconfigured for MGC-only
  - `tickers.ts`: MGC only (removed MYM/MES)
  - `TickerContext.tsx`: hardcoded MGC as initial ticker
  - `ChartPanel.tsx`: candle stores use MGC key only
  - `signalr_manager.py`: ACTIVE_CONTRACTS = [MGC] only
  - `main.py`: DEFAULT_CONTRACT = CON.F.US.MGC.M26
  - `vite.config.ts`: port 5174, proxy → 8001
  - `ws.ts`: WebSocket connects to port 8001
