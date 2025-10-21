#!/usr/bin/env python3
"""
Test CDIP NetCDF access directly
"""
from netCDF4 import Dataset
import xarray as xr

# Test for Del Mar Nearshore (Station 153)
cdip_id = "153"
url = f"https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/{cdip_id}p1/{cdip_id}p1_direc_wave.nc"

print(f"🔍 Testing CDIP access...")
print(f"📍 URL: {url}\n")

# Method 1: netCDF4
print("=" * 60)
print("Method 1: Using netCDF4.Dataset")
print("=" * 60)
try:
    ds = Dataset(url)
    print(f"✅ Successfully opened with netCDF4!")
    print(f"\n📊 Available variables:")
    for var_name in list(ds.variables.keys())[:15]:  # Show first 15
        var = ds.variables[var_name]
        shape = var.shape if hasattr(var, 'shape') else 'N/A'
        print(f"  - {var_name}: {shape}")
    
    # Check for required variables
    print(f"\n🎯 Checking required variables:")
    required = ['time', 'significant_wave_height', 'peak_wave_period']
    for req_var in required:
        if req_var in ds.variables:
            print(f"  ✅ {req_var}: Found")
        else:
            print(f"  ❌ {req_var}: NOT FOUND")
    
    ds.close()
except Exception as e:
    print(f"❌ Failed with netCDF4: {type(e).__name__}: {e}")

print("\n" + "=" * 60)
print("Method 2: Using xarray")
print("=" * 60)
try:
    ds = xr.open_dataset(url)
    print(f"✅ Successfully opened with xarray!")
    print(f"\n📊 Available variables:")
    for var_name in list(ds.data_vars)[:15]:  # Show first 15
        print(f"  - {var_name}: {ds[var_name].shape}")
    
    # Check for required variables
    print(f"\n🎯 Checking required variables:")
    required = ['time', 'significant_wave_height', 'peak_wave_period']
    for req_var in required:
        if req_var in ds:
            print(f"  ✅ {req_var}: Found - shape {ds[req_var].shape}")
        else:
            print(f"  ❌ {req_var}: NOT FOUND")
    
    # Try to read some data
    if 'significant_wave_height' in ds:
        print(f"\n📈 Sample data:")
        hs = ds['significant_wave_height']
        print(f"  Wave height values: {hs.values[:5]}")
    
    ds.close()
except Exception as e:
    print(f"❌ Failed with xarray: {type(e).__name__}: {e}")

print("\n" + "=" * 60)
print("Summary")
print("=" * 60)
print("If both methods failed, the CDIP URL might be:")
print("  1. Incorrect or outdated")
print("  2. Requiring authentication")
print("  3. Temporarily unavailable")
print("  4. Using a different variable naming scheme")
print("\nIf methods succeeded but required variables are missing,")
print("we need to adjust the variable names in the backend code.")

