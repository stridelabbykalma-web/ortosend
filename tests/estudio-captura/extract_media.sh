#!/bin/bash
# uso: extract_media.sh <kind> <nombre_salida> → guarda el archivo subido y una tira de fotogramas en out/
kind=$1; name=$2; O="$(cd "$(dirname "$0")" && pwd)/out"; mkdir -p "$O"
DB=${DATABASE_URL:?DATABASE_URL}; CASE=${CASE_ID:?CASE_ID}
id=$(psql "$DB" -tAc "select m.id from \"MediaAsset\" m join \"Capture\" c on c.id=m.\"captureId\" where c.\"caseId\"='$CASE' and m.kind='$kind' and m.\"confirmedAt\" is not null order by m.\"confirmedAt\" desc limit 1")
[ -z "$id" ] && { echo "sin media $kind"; exit 1; }
mime=$(psql "$DB" -tAc "select mime from \"MediaBlob\" where \"mediaId\"='$id'")
ext=webm; case "$mime" in image/jpeg) ext=jpg;; image/png) ext=png;; video/mp4) ext=mp4;; esac
psql "$DB" -tAc "select encode(bytes,'base64') from \"MediaBlob\" where \"mediaId\"='$id'" | base64 -d > "$O/$name.$ext"
echo "$id $mime $(stat -c %s "$O/$name.$ext") bytes → $O/$name.$ext"
if [ "$ext" = webm ] || [ "$ext" = mp4 ]; then
  ffmpeg -v error -y -i "$O/$name.$ext" -vf "select='isnan(prev_selected_t)+gte(t-prev_selected_t\,1.6)',scale=256:-2,tile=6x1,drawtext=text='$name':x=5:y=5:fontsize=20:fontcolor=yellow:box=1:boxcolor=black" -frames:v 1 "$O/${name}_strip.png" && echo "tira: $O/${name}_strip.png"
fi
