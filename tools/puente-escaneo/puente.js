#!/usr/bin/env node
// ============================================================
// Puente de escaneo Ortosend — PC del escáner (RevoScan)
// ============================================================
// Vigila la carpeta donde RevoScan exporta los mesh y sube cada modelo 3D
// nuevo al almacén común de Ortosend. Quién es el paciente lo decide el
// servidor: el caso que está abierto en el paso del escaneo del asistente
// de captura. Aquí no hay carpetas por paciente ni nombres que respetar.
//
//   node puente.js              (lee puente.config.json de esta misma carpeta)
//   node puente.js otro.json
//
// Requisitos: Node 18 o superior. Sin dependencias.
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");

const CONFIG_PATH = path.resolve(process.argv[2] || path.join(__dirname, "puente.config.json"));
const ESTADO_PATH = path.join(__dirname, "puente-estado.json");

// Extensiones que exporta RevoScan (más el ZIP del proyecto).
const EXTS = [".stl", ".obj", ".ply", ".glb", ".gltf", ".3mf", ".asc", ".zip"];
// Un archivo se sube cuando lleva dos vueltas con el mismo tamaño: así no se
// envía a medias mientras RevoScan todavía está escribiéndolo.
const CICLO_MS = 5000;
const SALUDO_MS = 60000;

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

// Saludo: comprueba el token y deja constancia en el panel de que el puente
// está en marcha (el asistente avisa al profesional si no da señal).
async function saludar(cfg) {
  const { ok, status, cuerpo } = await api(cfg, "/api/scan/ingest");
  if (!ok) {
    log(`El servidor no acepta el token (HTTP ${status}${cuerpo?.error ? `: ${cuerpo.error}` : ""})`);
    return null;
  }
  return cuerpo;
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

// Los mesh pesan mucho y se repiten los vértices: comprimidos con gzip se
// quedan en una fracción. Se comprime a un temporal (hace falta saber el
// tamaño final para la subida) y el almacén los sirve descomprimidos solos.
async function comprimir(archivo) {
  const tmp = path.join(os.tmpdir(), `ortosend-${process.pid}-${Date.now()}.gz`);
  await pipeline(fs.createReadStream(archivo), zlib.createGzip({ level: 6 }), fs.createWriteStream(tmp));
  return { tmp, bytes: (await fsp.stat(tmp)).size };
}

// Subida directa al almacén (R2) con URL firmada: el archivo no pasa por el
// servidor de Ortosend, así que no hay límite de tamaño. Si el servidor no
// tiene R2, lo manda entero por /api/scan/ingest.
async function subir(cfg, archivo, tamano) {
  const nombre = path.basename(archivo);
  const gz = await comprimir(archivo);
  try {
    log(`  comprimido: ${(tamano / 1048576).toFixed(1)} MB → ${(gz.bytes / 1048576).toFixed(1)} MB`);
    const plan = await api(cfg, "/api/scan/subida", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, bytes: tamano, encoding: "gzip", storedBytes: gz.bytes }),
    });
    if (!plan.ok) return plan;

    if (plan.cuerpo.modo === "directo") {
      const res = await fetch(plan.cuerpo.url, {
        method: "PUT",
        headers: { ...(plan.cuerpo.headers || {}), "Content-Length": String(gz.bytes) },
        body: fs.createReadStream(gz.tmp),
        duplex: "half",
      });
      if (!res.ok)
        return { ok: false, status: res.status, cuerpo: { error: `El almacén rechazó el archivo (HTTP ${res.status})` } };
      return api(cfg, "/api/scan/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: plan.cuerpo.uploadId }),
      });
    }

    if (gz.bytes > plan.cuerpo.maxBytes)
      return {
        ok: false,
        status: 413,
        cuerpo: { error: `Sin almacén R2 el servidor no admite más de ${(plan.cuerpo.maxBytes / 1048576).toFixed(0)} MB` },
      };
    const form = new FormData();
    form.append("nombre", nombre);
    form.append("bytes", String(tamano));
    form.append("encoding", "gzip");
    form.append("file", new Blob([await fsp.readFile(gz.tmp)]), nombre);
    return api(cfg, "/api/scan/ingest", { method: "POST", body: form });
  } finally {
    await fsp.rm(gz.tmp, { force: true });
  }
}

async function ciclo(cfg, estado, tamanos) {
  for await (const archivo of recorrer(cfg.carpeta)) {
    const ruta = path.resolve(archivo);
    let st;
    try {
      st = await fsp.stat(archivo);
    } catch {
      continue;
    }
    // La clave incluye tamaño y fecha: si se repite el escaneo y se guarda con
    // el mismo nombre, se vuelve a subir como un escaneo más del caso.
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
      r = await subir(cfg, archivo, st.size);
    } catch (e) {
      log(`Fallo de red al subir ${path.basename(archivo)}: ${e.message}. Se reintenta.`);
      continue;
    }
    if (r.ok) {
      estado.subidos[clave] = { at: new Date().toISOString(), caso: r.cuerpo?.caso ?? null };
      guardarEstado(estado);
      if (r.cuerpo?.caso) log(`✓ Asociado al caso #${r.cuerpo.caso} — ${r.cuerpo.paciente}`);
      else log("✓ Subido. Nadie esperaba escaneo: queda en la bandeja para confirmarlo desde el asistente.");
    } else if (r.status === 400 || r.status === 413 || r.status === 415) {
      // Formato o tamaño que este servidor nunca va a aceptar: no se reintenta.
      estado.subidos[clave] = { at: new Date().toISOString(), descartado: r.cuerpo?.error ?? r.status };
      guardarEstado(estado);
      log(`✗ Descartado ${path.basename(archivo)}: ${r.cuerpo?.error ?? `HTTP ${r.status}`}`);
    } else {
      // 401 (token revocado), 409 (llegó incompleto), 5xx: se reintenta en la
      // siguiente vuelta por si es algo pasajero.
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
  await fsp.mkdir(cfg.carpeta, { recursive: true });

  const hola = await saludar(cfg);
  if (hola)
    log(
      `Clínica: ${hola.clinica} · modo ${hola.modo === "directo" ? "directo al almacén (sin límite de tamaño)" : `servidor (máx. ${(hola.maxBytes / 1048576).toFixed(0)} MB)`}`
    );
  setInterval(() => saludar(cfg).catch((e) => log("Error:", e.message)), SALUDO_MS);

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
