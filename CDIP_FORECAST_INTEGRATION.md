# 🌊 CDIP 5-Day Forecast Integration

## ✅ Correct CDIP Data Source Found!

### URL Pattern
```
https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/{station_id}p1/{station_id}p1_direc_wave.nc
```

### Example: Del Mar Nearshore (Station 153)
```
https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/153p1/153p1_direc_wave.nc
```

## 📊 Available Variables

| Variable | Description | Use Case |
|----------|-------------|----------|
| `time` | Forecast timestamps | X-axis for all charts |
| `significant_wave_height` | Hs forecast (meters) | Main wave height chart |
| `peak_wave_period` | Peak period (seconds) | Period chart |
| `waveDirection` | Direction (degrees) | Direction indicator |
| `waveEnergyDensity` | Spectral wave energy | Advanced: Energy density plots |
| `waveFrequency` | Frequency axis (Hz) | Advanced: Spectral analysis |

## 🎯 What We Can Build

### 1. 5-Day Wave Height Forecast (Primary)
**Data**: `significant_wave_height` over `time`  
**Chart**: Line graph showing Hs forecast  
**Status**: ✅ Backend code updated, needs testing

### 2. Conditions + Forecast Chart
**Data**: `significant_wave_height` + `peak_wave_period` + `waveDirection`  
**Chart**: Multi-line chart with 3 metrics  
**Status**: 🔜 Next step

### 3. Spectral Energy Density (Advanced)
**Data**: `waveEnergyDensity` over `waveFrequency` and `time`  
**Chart**: 2D bubble plot (frequency vs energy)  
**Status**: 🔮 Future enhancement

## 🔧 Backend Implementation

### Current Status
- ✅ URL pattern updated to use `archive/{station_id}p1/`
- ✅ Variable names corrected (`significant_wave_height`, `peak_wave_period`)
- ✅ Error logging added
- ⚠️ Needs testing with live data

### Code Location
`backend/main.py` → `fetch_cdip_ecmwf_forecast()`

### Python Libraries
```bash
pip install xarray netCDF4 numpy
```

### Example Usage (Python)
```python
import xarray as xr

ds = xr.open_dataset('https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/153p1/153p1_direc_wave.nc')
times = ds['time'].values
heights = ds['significant_wave_height'].values
periods = ds['peak_wave_period'].values

# Convert to datetime
import pandas as pd
times_dt = pd.to_datetime(times)

# Plot
import matplotlib.pyplot as plt
plt.plot(times_dt, heights)
plt.xlabel('Time')
plt.ylabel('Wave Height (m)')
plt.title('CDIP 5-Day Forecast - Del Mar')
plt.show()
```

## 🧪 Testing Steps

### 1. Test Backend Endpoint
```bash
# Clear cache
curl "http://localhost:8000/api/cache/clear"

# Fetch forecast
curl "http://localhost:8000/api/buoy-forecast/46266?hours=120"
```

**Expected Response**:
```json
{
  "station_id": "46266",
  "cdip_id": "153p1",
  "cdip_available": true,
  "forecast_hours": 120,
  "data": [
    {
      "timestamp": "2025-10-22T00:00:00Z",
      "wvht_m": 1.5,
      "wvht_ft": 4.9,
      "dpd_sec": 12.0,
      "surf_height_m": 2.8,
      "wave_energy": 27.0,
      "source": "cdip_ecmwf",
      "confidence": "high"
    }
  ]
}
```

### 2. Check Backend Logs
Look for these messages in `uvicorn` output:
```
Attempting to fetch CDIP forecast from: https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/153p1/153p1_direc_wave.nc
Available variables in CDIP file: ['time', 'significant_wave_height', 'peak_wave_period', ...]
```

### 3. Test Frontend
- Open buoy detail panel
- Click "Show Wave History"
- Check the "5-day forecast" checkbox
- Forecast line should appear (dotted line)

## 🗺️ CDIP Station Mapping

All 14 buoys → CDIP stations mapping in `cdip_station_mapping.json`:

| NDBC Buoy | CDIP Station | Location |
|-----------|--------------|----------|
| 46266 | 153p1 | Del Mar Nearshore |
| 46225 | 100p1 | Torrey Pines Outer |
| 46254 | 220p1 | Scripps Nearshore |
| 46086 | 191p1 | San Clemente Island |
| 46224 | 191p1 | San Clemente |
| 46047 | 067p1 | Tanner Banks |
| 46221 | 045p1 | Santa Monica Bay |
| 46025 | 071p1 | Santa Monica Basin |
| 46222 | 071p1 | San Pedro |
| 46223 | 092p1 | San Pedro South |
| 46253 | 215p1 | Point Loma South |
| 46231 | 220p1 | Oceanside Offshore |
| 46232 | 100p1 | Point Loma |
| 46235 | 157p1 | Imperial Beach Nearshore |

## 📈 Next Steps

1. **Test Real Data Access**
   - Check if CDIP NetCDF files are accessible
   - Verify variable names match documentation
   - Handle any authentication/CORS issues

2. **Improve Forecast Display**
   - Show "CDIP Model" vs "Trend Projection" in UI
   - Add confidence indicator
   - Better time formatting

3. **Add More Metrics**
   - Peak period forecast chart
   - Direction indicator on forecast
   - Fetch frequency for all 14 stations

4. **Advanced Visualizations** (Future)
   - Spectral energy density plots
   - Period vs Energy scatter
   - Directional wave roses

## 🐛 Common Issues

### Issue: "CDIP Available: True" but using trend projection
**Cause**: NetCDF file access failed  
**Debug**: Check backend logs for error message  
**Fix**: Verify URL, check network access, ensure netCDF4/xarray installed

### Issue: Variables not found
**Cause**: Variable names differ from documentation  
**Debug**: Print `list(dataset.variables.keys())`  
**Fix**: Update variable name mapping in code

### Issue: Time conversion errors
**Cause**: CDIP uses different time units  
**Debug**: Check `time_var.units` attribute  
**Fix**: Use proper time unit conversion (netCDF4.num2date)

## 📚 References

- **CDIP THREDDS Server**: https://thredds.cdip.ucsd.edu/thredds/catalog.html
- **Station 153 Archive**: https://thredds.cdip.ucsd.edu/thredds/catalog/cdip/archive/153p1/catalog.html
- **xarray Docs**: https://docs.xarray.dev/
- **netCDF4 Python**: https://unidata.github.io/netcdf4-python/

---

**Status**: ✅ URL pattern corrected, ready for testing  
**Last Updated**: 2025-10-21  
**Next**: Verify real CDIP data access with backend logs

