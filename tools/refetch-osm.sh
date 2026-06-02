#!/usr/bin/env bash
# tools/refetch-osm.sh — (re)fetch real road data from OpenStreetMap (Overpass)
# and bake it into the compact graph JSON the app loads. Dev-time only; needs network.
#
#   bash tools/refetch-osm.sh            # fetch + bake all cities
#   bash tools/refetch-osm.sh monaco     # just one
#
# Overpass needs a real User-Agent (its default-UA block returns HTTP 406).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p tools/osm-raw data

UA='PathfindingAtlas/1.0 (educational project; https://github.com/PyCoder42/pathfinding-atlas)'
API='https://overpass-api.de/api/interpreter'

# key | "Display Name" | south,west,north,east  (driving area bbox)
CITIES=(
  "monaco|Monaco|43.7234,7.4090,43.7519,7.4400"
  "manhattan|Midtown Manhattan|40.7440,-74.0080,40.7720,-73.9650"
  "cambridge|Cambridge, UK|52.1850,0.0900,52.2250,0.1600"
)

want="${1:-all}"
for row in "${CITIES[@]}"; do
  IFS='|' read -r key name bbox <<<"$row"
  [ "$want" = "all" ] || [ "$want" = "$key" ] || continue
  raw="tools/osm-raw/${key}.osm.json"
  out="data/${key}.json"
  q="[out:json][timeout:180];(way[\"highway\"](${bbox});>;);out body;"
  echo "→ Fetching ${name} (${bbox}) …"
  code=$(curl -sS -m 200 -A "$UA" -X POST "$API" --data-urlencode "data=$q" -o "$raw" -w '%{http_code}')
  if [ "$code" != "200" ]; then
    echo "  ✗ Overpass HTTP $code for ${name}; leaving existing ${out} untouched." >&2
    continue
  fi
  echo "  baking → ${out}"
  node tools/bake-osm.js "$raw" "$out" "$name"
done
