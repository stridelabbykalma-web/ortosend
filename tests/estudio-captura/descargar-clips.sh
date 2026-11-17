#!/bin/bash
# Descarga clips libres de Mixkit de personas andando y los convierte a MJPEG,
# que es el formato que Chromium acepta como "cámara falsa"
# (--use-file-for-fake-video-capture). No se guardan en el repositorio.
set -e
D="$(cd "$(dirname "$0")" && pwd)/clips"; mkdir -p "$D"; cd "$D"
UA="OrtosendCaptureTest/1.0"
get() { [ -s "v$1.mp4" ] || curl -sS -A "$UA" -o "v$1.mp4" "https://assets.mixkit.co/videos/$1/$1-360.mp4"; }
conv() { ffmpeg -v error -y -i "v$1.mp4" ${3:+-t $3} -vf "${4:-scale=640:360,fps=30}" -q:v 5 -f mjpeg "$2.mjpeg"; }
get 4889;  conv 4889 post_4889                       # chico alejándose por la calle (posterior)
conv 4889 post_4889_rot180 "" "scale=640:360,fps=30,transpose=1,transpose=1"
conv 4889 post_4889_rot90  "" "scale=640:360,fps=30,transpose=1"
conv 4889 post_4889_rot270 "" "scale=640:360,fps=30,transpose=2"
conv 4889 foto_crop_4889 4 "crop=iw*0.5:ih*0.42:iw*0.25:ih*0.58,scale=640:360,fps=30"  # solo piernas y pies
get 23378; conv 23378 post_23378                    # operario alejándose por un pasillo (posterior)
get 32748; conv 32748 post_32748                    # mujer de espaldas con los pies cortados (debe rechazarse)
get 32623; conv 32623 ant_32623                     # mujer viniendo de frente, cuerpo entero (anterior)
get 35830; conv 35830 ant_far_35830                 # persona muy lejana en un camino (límite del modelo)
get 4888;  conv 4888 lat_4888                       # hombre de perfil (no debe arrancar)
get 40656; conv 40656 nobody_40656 20               # camino sin nadie
ls -la "$D"/*.mjpeg | awk '{print $5, $9}'
