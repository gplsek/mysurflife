"""One-time backfill after migration 022: seed spot_forecast_tuning.buoy_blend
for migrated private spots that don't have one yet, so /conditions works
immediately (same auto-IDW blend a freshly created private spot gets).

Usage:
    cd backend && source venv/bin/activate && python3 backfill_user_spot_blends.py
"""
from routes.user_spots import _auto_buoy_blend, _client


def main() -> None:
    client = _client()
    if not client:
        print("❌ no Supabase client (check SUPABASE_* env)")
        return

    spots = (
        client.table("spots")
        .select("id, name, latitude, longitude, spot_forecast_tuning(spot_id)")
        .eq("visibility", "private")
        .execute()
    ).data or []

    missing = [s for s in spots if not s.get("spot_forecast_tuning")]
    print(f"🔎 {len(spots)} private spots, {len(missing)} missing a buoy blend")

    for s in missing:
        blend = _auto_buoy_blend(s["latitude"], s["longitude"])
        if not blend:
            print(f"⚠️  {s['name']} ({s['id']}): no blend computable, skipped")
            continue
        client.table("spot_forecast_tuning").insert(
            {"spot_id": s["id"], "buoy_blend": blend}
        ).execute()
        print(f"✅ {s['name']}: {', '.join(blend.keys())}")

    print("done")


if __name__ == "__main__":
    main()
