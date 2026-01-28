# MySurfLife 🌊

Real-time surf forecasting dashboard combining NOAA buoy observations with wave/wind model forecasts and AI-powered spot analysis.

**Live Site**: https://mysurflife.com

---

## Features

### 🌊 Real-Time Surf Data
- **36 NOAA buoys** including California, Oregon, Washington, Hawaii
- **Live conditions** with wave height, period, direction, wind
- **Surf scoring** algorithm for spot quality assessment
- **Interactive map** with buoy markers and spot locations

### 🎨 Advanced Visualizations
- **Wind overlays** with particle animations (Windy.com style)
- **Wave height heatmaps** with directional particles
- **Multiple forecast models**: GFS, HRRR, NAM, WaveWatch III
- **Timeline slider** for 48-hour forecast progression

### 🤖 AI Spot Analysis
- **Multi-model AI**: Claude Sonnet 4 + OpenAI GPT-4o
- **Global support**: Works for any surf spot worldwide
- **Tabbed comparison**: Side-by-side AI analysis
- **Swell geometry**: Wave refraction, shadow zones, optimal windows

### 🏄 Surf Spots
- **Detailed spot pages** with conditions, timeline, AI analysis
- **Spot scoring** based on swell direction, size, wind
- **Spot characteristics**: Break type, skill level, hazards
- **Admin editing**: Inline spot data management

### 🔐 Authentication & Admin
- **Supabase authentication** with role-based access
- **Admin dashboard** for spot and persona management
- **Secure API** with JWT token validation

---

## Tech Stack

### Frontend
- **React** 18 - Modern UI framework
- **Leaflet** - Interactive maps
- **Canvas API** - High-performance overlays
- **React Hooks** - State and lifecycle management

### Backend
- **FastAPI** - Python async web framework
- **Supabase** - PostgreSQL database + auth
- **Redis** - Multi-level caching (L1: memory, L2: Redis, L3: disk)
- **Anthropic/OpenAI** - AI model APIs

### Data Sources
- **NDBC** - NOAA buoy observations (18 California, 6 Hawaii)
- **WaveWatch III** - Global wave model forecasts
- **GFS/HRRR/NAM** - Wind model forecasts
- **CDIP** - Coastal Data Information Program (planned)

---

## Quick Start

### Development

```bash
# Backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend
cd frontend
npm install
npm start
```

### Production Deployment

See **[notes/DEPLOYMENT_GUIDE.md](./notes/DEPLOYMENT_GUIDE.md)** for complete instructions.

---

## Documentation

All project documentation is organized in the **[./notes/](./notes/)** directory.

### 📖 Quick Links

- **[Documentation Index](./notes/INDEX.md)** - Complete documentation catalog
- **[Deployment Guide](./notes/DEPLOYMENT_GUIDE.md)** - Production deployment steps
- **[Tabbed AI Analysis](./notes/TABBED_AI_ANALYSIS.md)** - Multi-model AI feature
- **[Global Spot Analysis](./notes/GLOBAL_SPOT_ANALYSIS.md)** - Worldwide spot support
- **[Supabase Setup](./notes/SUPABASE_SETUP.md)** - Database schema and setup

### 📚 Documentation Categories

- **🚀 Deployment & Operations** - Production deployment, performance, monitoring
- **🤖 AI Integration** - Multi-model AI, personas, global analysis
- **🏄 Surf Spots** - Spot system, scoring, detail pages
- **🔧 Admin & Auth** - Authentication, admin features, editing
- **🌊 Overlays** - Wind/wave visualizations, particle animations
- **🗄️ Database** - Supabase, CDIP integration, schema

See **[notes/INDEX.md](./notes/INDEX.md)** for the complete list.

---

## Project Structure

```
mysurflife/
├── backend/              # FastAPI backend
│   ├── main.py          # Main API server
│   ├── ai_personas_spots.py         # Claude AI integration
│   ├── ai_personas_spots_openai.py  # OpenAI integration
│   ├── buoy_registry.py  # Buoy metadata
│   ├── surf_scoring.py   # Spot scoring algorithm
│   ├── auth.py          # Authentication middleware
│   └── database.py      # Supabase client
├── frontend/            # React frontend
│   ├── src/
│   │   ├── App.js       # Main app component
│   │   ├── MapOverlay.js        # Map orchestrator
│   │   ├── SpotDetail.js        # Spot detail page
│   │   ├── AISpotAnalysis.js    # AI analysis tabs
│   │   └── WindCanvasLayer.js   # Wind overlay
│   └── public/
├── notes/               # 📚 All documentation
│   └── INDEX.md        # Documentation index
├── CLAUDE.md           # Claude Code instructions
└── README.md           # This file
```

---

## Environment Variables

Required environment variables (see `.env.example`):

```bash
# API Keys
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key

# Redis (optional)
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

## API Endpoints

### Buoy Data
- `GET /api/buoy-status/all` - All buoys with current conditions
- `GET /api/buoy-history/{station_id}` - Historical time series

### Surf Spots
- `GET /api/surf-spots` - All surf spots with scores
- `GET /api/surf-spots/{slug}` - Spot details
- `GET /api/surf-spots/{slug}/conditions` - Current conditions
- `GET /api/surf-spots/{slug}/forecast-timeline` - 48-hour forecast

### AI Analysis
- `GET /api/spots/{slug}/ai-analysis/all` - All AI analyses (Claude + OpenAI)
- `POST /api/spots/{slug}/ai-analysis/generate` - Generate Claude analysis
- `POST /api/spots/{slug}/ai-analysis/generate-openai` - Generate OpenAI analysis

### Overlays
- `GET /api/wind-overlay` - Wind vector field (GFS/HRRR/NAM)
- `GET /api/waves-overlay` - Wave height field (WaveWatch III)

See **[notes/SURF_SPOTS_API.md](./notes/backend/SURF_SPOTS_API.md)** for complete API documentation.

---

## Contributing

### Development Workflow

1. **Read CLAUDE.md** - Project conventions and patterns
2. **Check notes/INDEX.md** - Find relevant documentation
3. **Create feature branch** - `git checkout -b feature/name`
4. **Document changes** - Add notes to `./notes/`
5. **Update INDEX.md** - Add new documentation entry
6. **Test thoroughly** - Frontend + Backend + API
7. **Create PR** - With clear description

### Code Style

- **Python**: Type hints, f-strings, descriptive names
- **JavaScript**: Functional components, hooks, clear variable names
- **Documentation**: Markdown with clear structure and examples

---

## Performance

- **L1 Cache** (memory): 5-10 min TTL for buoy/wind data
- **L2 Cache** (Redis): Shared across workers, 30 min TTL
- **L3 Cache** (disk): Raw NetCDF/GRIB responses
- **Request deduplication**: Task D pattern for concurrent requests
- **Concurrency control**: Semaphores for rate limiting

See **[notes/PERFORMANCE_OPTIMIZATION_PLAN.md](./notes/PERFORMANCE_OPTIMIZATION_PLAN.md)** for details.

---

## License

Proprietary - All rights reserved

---

## Contact

For questions or issues, see the documentation in `./notes/` or check the deployment guide.

**Documentation Index**: [notes/INDEX.md](./notes/INDEX.md)

---

**Last Updated**: 2026-01-28
**Version**: Multi-Model AI (Claude Sonnet 4 + OpenAI GPT-4o)
**Commit**: `d716c77` - Multi-model AI spot analysis with global support
