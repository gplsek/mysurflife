# mysurflife

A local-first surf conditions dashboard app built with FastAPI (backend) and React + Leaflet (frontend).

## ✅ Project Goals
- Live surf buoy data from NDBC & CDIP
- Auto-refreshing backend API for buoy status
- Frontend map overlay showing current conditions
- Scalable for future surf scoring, alerts, forecasts

## 📁 Project Structure
mysurflife/
├── backend/           # FastAPI backend
│   └── main.py        # Serves /api/buoy-status endpoint
├── frontend/          # React app with Leaflet map
│   └── src/           # React components
│       └── MapOverlay.js
└── README.md          # Project notes and roadmap

## 🔁 Current Progress
### [✔] Backend API: `/api/buoy-status`
- Fetches live data from NDBC Buoy 46266
- Parses timestamp, wave height, period, direction
- Returns JSON payload for frontend

### [ ] Frontend Map UI (next step)
- Leaflet map showing buoy as marker
- Popup with live wave info
- Auto-refresh or button to re-fetch data

## 🧱 Stack
- **Backend**: Python 3.10, FastAPI, httpx
- **Frontend**: React (JavaScript), Leaflet
- **Dev**: Local run first, deploy later
