#!/usr/bin/env node
// ============================================================
// Puente de escaneo Ortosend — PC del escáner (RevoScan)
// ============================================================
// RevoScan deja elegir la carpeta donde se guarda cada escaneo. Este programa
// vigila una carpeta base, mantiene dentro una carpeta por caso abierto
// (ORT-00123-XXXXXXXX-nombre) y sube a Ortosend cualquier modelo 3D que
// aparezca en ellas. El caso —y por tanto el paciente— sale del nombre de la
// carpeta, así que el profesional solo tiene que guardar donde le dice la app.
//
//   node puente.js              (lee puente.config.json de esta misma carpeta)
//   node puente.js otro.json
//
// Requisitos: Node 18 o superior. Sin dependencias.
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const CONFIG_PATH = path.resolve(process.argv[2] || path.join(__dirname, "puente.config.json"));
const ESTADO_PATH = path.join(__dirname, "puente-estado.json");

// Extensiones que exporta RevoScan (más el ZIP del proyecto).
const EXTS = [".stl", ".obj", ".ply", ".glb", ".gltf", ".3mf", ".asc", ".zip"];
// Un archivo se sube cuando lleva dos vueltas con el mismo tamaño: así no se
// envía a medias mientras RevoScan todavía está escribiéndolo.
const CICLO_MS = 5000;
const SINCRONIZA_CARPETAS_MS = 60000;

function log(...args) {
  console.log(new Date().toLocaleTimeString("es-ES"), ...args);
}

function leerConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch {
    console.error(`No se encuentra la configuración: ${CONFIG_PATH}`);
    console.error("Copia puente.config.example.json a puente.config.json y rellénalo.");
    process.exit(1);
  }
  const cfg = JSON.parse(raw);
  const servidor = (process.env.ORTOSEND_URL || cfg.servidor || "").replace(/\/+$/, "");
  const token = process.env.ORTOSEND_TOKEN || cfg.token || "";
  const carpeta = process.env.ORTOSEND_CARPETA || cfg.carpeta || "";
  if (!servidor || !token || !carpeta) {
    console.error("Faltan datos en la configuración: servidor, token y carpeta son obligatorios.");
    process.exit(1);
  }
  return { servidor, token, carpeta };
}

// Archivos ya subidos (para no repetirlos en cada arranque).
function leerEstado() {
  try {
    return JSON.parse(fs.readFileSync(ESTADO_PATH, "utf8"));
  } catch {
    return { subidos: {} };
  }
}
function guardarEstado(estado) {
  try {
    fs.writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2));
  } catch (e) {
    log("No se pudo guardar el estado local:", e.message);
  }
}

async function api(cfg, ruta, opciones = {}) {
  const res = await fetch(`${cfg.servidor}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${cfg.token}`, ...(opciones.headers || {}) },
  });
  let cuerpo = null;
  try {
    cuerpo = await res.json();
  } catch {
    // respuesta no JSON (proxy, error de red): se trata como fallo
  }
  return { ok: res.ok, status: res.status, cuerpo };
}

// Crea en la carpeta base una carpeta por caso abierto, para que en el diálogo
// de guardar de RevoScan ya estén ahí y solo haya que elegirla.
async function sincronizarCarpetas(cfg) {
  const { ok, status, cuerpo } = await api(cfg, "/api/scan/ingest");
  if (!ok) {
    log(`No se pudo leer la lista de casos (HTTP ${status}${cuerpo?.error ? `: ${cuerpo.error}` : ""})`);
    return;
  }
  await fsp.mkdir(cfg.carpeta, { recursive: true });
  let nuevas = 0;
  for (const c of cuerpo.carpetas || []) {
    const dir = path.join(cfg.carpeta, c.folder);
    if (!fs.existsSync(dir)) {
      await fsp.mkdir(dir, { recursive: true });
      nuevas++;
    }
  }
  if (nuevas) log(`Carpetas de casos nuevas: ${nuevas} (clínica: ${cuerpo.clinica})`);
}

async function* recorrer(dir) {
  let entradas;
  try {
    entradas = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entradas) {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) yield* recorrer(completo);
    else if (EXTS.includes(path.extname(e.name).toLowerCase())) yield completo;
  }
}

async function subir(cfg, archivo) {
  // La ruta completa lleva el nombre de la carpeta del caso: el servidor saca
  // de ahí el código y asocia el escaneo al paciente.
  const datos = await fsp.readFile(archivo);
  const form = new FormData();
  form.append("code", archivo);
  form.append("nombre", path.basename(archivo));
  form.append("file", new Blob([datos]), path.basename(archivo));
  const { ok, status, cuerpo } = await api(cfg, "/api/scan/ingest", { method: "POST", body: form });
  return { ok, status, cuerpo };
}

async function ciclo(cfg, estado, tamanos) {
  for await (const archivo of recorrer(cfg.carpeta)) {
    const ruta = path.resolve(archivo);
    // Sin código de caso en la ruta no se toca el archivo (carpetas sueltas).
    if (!/ORT-\d{1,9}-[A-HJ-NP-Z2-9]{8}/i.test(ruta)) continue;

    let st;
    try {
      st = await fsp.stat(archivo);
    } catch {
      continue;
    }
    // La clave incluye tamaño y fecha: si se repite el escaneo y se guarda con
    // el mismo nombre, se vuelve a subir y sustituye al anterior en el caso.
    const clave = `${ruta}|${st.size}|${Math.round(st.mtimeMs)}`;
    if (estado.subidos[clave]) continue;
    // Se espera a que el tamaño se estabilice: RevoScan puede seguir escribiendo.
    if (tamanos.get(ruta) !== st.size) {
      tamanos.set(ruta, st.size);
      continue;
    }

    log(`Subiendo ${path.basename(archivo)} (${(st.size / 1048576).toFixed(1)} MB)…`);
    let r;
    try {
      r = await subir(cfg, archivo);
    } catch (e) {
      log(`Fallo de red al subir ${path.basename(archivo)}: ${e.message}. Se reintenta.`);
      continue;
    }
    if (r.ok) {
      estado.subidos[clave] = { at: new Date().toISOString(), caso: r.cuerpo?.caso ?? null };
      guardarEstado(estado);
      log(`✓ Asociado al caso #${r.cuerpo?.caso} — ${r.cuerpo?.paciente}`);
    } else if (r.status === 400 || r.status === 404 || r.status === 415) {
      // Carpeta o formato que este servidor nunca va a aceptar: no se reintenta.
      estado.subidos[clave] = { at: new Date().toISOString(), descartado: r.cuerpo?.error ?? r.status };
      guardarEstado(estado);
      log(`✗ Descartado ${path.basename(archivo)}: ${r.cuerpo?.error ?? `HTTP ${r.status}`}`);
    } else {
      // 401 (token revocado), 409 (estudio ya enviado), 413, 5xx: se reintenta
      // en la siguiente vuelta por si es algo pasajero.
      log(`✗ ${path.basename(archivo)}: ${r.cuerpo?.error ?? `HTTP ${r.status}`}. Se reintenta.`);
    }
  }
}

async function main() {
  const cfg = leerConfig();
  const estado = leerEstado();
  const tamanos = new Map();
  log(`Puente de escaneo Ortosend`);
  log(`Servidor: ${cfg.servidor}`);
  log(`Carpeta vigilada: ${cfg.carpeta}`);

  await sincronizarCarpetas(cfg);
  setInterval(() => sincronizarCarpetas(cfg).catch((e) => log("Error:", e.message)), SINCRONIZA_CARPETAS_MS);

  // Bucle secuencial: nunca hay dos subidas a la vez desde el mismo PC.
  for (;;) {
    try {
      await ciclo(cfg, estado, tamanos);
    } catch (e) {
      log("Error en el ciclo:", e.message);
    }
    await new Promise((r) => setTimeout(r, CICLO_MS));
  }
}

main();
