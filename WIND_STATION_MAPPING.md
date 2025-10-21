# Wind Station Mapping for MySurfLife

This document explains how we map buoys to nearby wind stations when the buoy itself doesn't have wind sensors.

## 🎯 Mapping Strategy

- Buoys **with wind data** → Use their own wind readings (`null` mapping)
- Buoys **without wind data** → Use nearest coastal wind station

---

## 📍 Wind Station Mapping

| Buoy ID | Buoy Name | Wind Station | Station Name | Distance |
|---------|-----------|--------------|--------------|----------|
| 46266 | Del Mar Nearshore | **LJAC1** | La Jolla (Scripps) | ~5 mi |
| 46225 | Torrey Pines Outer | **LJAC1** | La Jolla (Scripps) | ~8 mi |
| 46259 | Mission Bay | **SDBC1** | San Diego Bay | ~5 mi |
| 46232 | Point Loma South | **SDBC1** | San Diego Bay | ~8 mi |
| 46236 | Imperial Beach | **TIXC1** | Tijuana River Reserve | ~3 mi |
| 46258 | San Pedro Channel | **LJAC1** | La Jolla (Scripps) | ~85 mi |
| 46222 | Santa Monica Basin | **AGXC1** | Angels Gate (LA) | ~20 mi |
| 46086 | Pt. Dume / Santa Barbara | `null` | *(has wind)* | - |
| 46011 | Santa Maria | `null` | *(has wind)* | - |
| 46027 | Cape Mendocino | `null` | *(has wind)* | - |
| 46014 | Pt. Arena | `null` | *(has wind)* | - |
| 46026 | San Francisco Bar | **FTPC1** | Fort Point (SF) | ~5 mi |
| 46012 | Monterey Bay | **MEYC1** | Monterey CO-OPS | ~2 mi |
| 46013 | Bodega Bay | **PRYC1** | Point Reyes | ~35 mi |

---

## 🌊 NOAA Coastal Wind Stations (NOS CO-OPS)

### Southern California
- **LJAC1** - La Jolla (Scripps Pier), CA ✅
  - Location: 32.867°N, 117.257°W
  - Type: NOS CO-OPS tide station with meteorological sensors
  - https://www.ndbc.noaa.gov/station_page.php?station=ljac1
  - **Status: ACTIVE** (verified wind data)

- **SDBC1** - San Diego Bay, CA
  - Location: 32.714°N, 117.174°W
  - Type: NOS CO-OPS tide station
  - https://www.ndbc.noaa.gov/station_page.php?station=sdbc1
  - **Status: LIMITED** (occasionally reports wind)

- **TIXC1** - Tijuana River Reserve, CA ✅
  - Location: 32.575°N, 117.127°W
  - Type: NERRS (National Estuarine Research Reserve)
  - **Status: ACTIVE** (met sensors)

- **AGXC1** - Angels Gate (Los Angeles), CA ✅
  - Location: 33.716°N, 118.246°W
  - Type: NOS PORTS meteorological station
  - https://www.ndbc.noaa.gov/station_page.php?station=agxc1
  - **Status: ACTIVE** (verified wind data)

### Central/Northern California
- **MEYC1** - Monterey, CA ✅
  - Location: 36.605°N, 121.889°W
  - Type: NOS CO-OPS tide station
  - https://www.ndbc.noaa.gov/station_page.php?station=meyc1
  - **Status: ACTIVE** (verified wind data)

- **FTPC1** - Fort Point, San Francisco, CA ✅
  - Location: 37.806°N, 122.466°W
  - Type: NOS CO-OPS tide station
  - https://www.ndbc.noaa.gov/station_page.php?station=ftpc1
  - **Status: ACTIVE** (verified wind data)

- **PRYC1** - Point Reyes, CA ✅
  - Location: 37.996°N, 122.977°W
  - Type: NOS CO-OPS tide station
  - https://www.ndbc.noaa.gov/station_page.php?station=pryc1
  - **Status: ACTIVE** (verified wind data)

---

## 📡 Data Source

Wind stations use the same NDBC format:
```
https://www.ndbc.noaa.gov/data/realtime2/{station}.txt
```

Parse columns:
- `WDIR` - Wind direction (degrees)
- `WSPD` - Wind speed (m/s)
- `GST` - Wind gust (m/s)

---

## 🔧 Implementation Notes

1. **Fallback Logic**: If buoy has wind data, use it. Otherwise, fetch from mapped station.
2. **Caching**: Cache wind station data for 10 minutes (same as buoy data)
3. **Error Handling**: If wind station fails, display "N/A" gracefully
4. **Distance Consideration**: Nearshore wind can vary significantly. Prefer closest station.

---

## ⚠️ Limitations

- **Wind variation**: Coastal wind can differ from offshore by 5-10+ knots
- **Land effects**: Land-based stations may show lighter winds due to terrain blocking
- **Best for**: General wind trend awareness, not precise offshore measurements

---

_Last updated: 2025-10-21_

