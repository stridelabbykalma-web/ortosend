#!/usr/bin/env node
// ============================================================
// Puente de escaneo Ortosend — PC del escáner (Revo Scan)
// ============================================================
// El profesional solo escanea. Este programa vigila dónde deja Revo Scan
// cada escaneo y lo sube entero al almacén común de Ortosend; el taller lo
// abre en su Revo Scan, lo procesa y exporta. Quién es el paciente lo decide
// el servidor: el caso abierto en el paso del escaneo del asistente.
//
// Vigila dos sitios (los dos opcionales, al menos uno):
//   carpetaRevoScan → escaneos en bruto: archivos de Revo Scan 6 («un escaneo,
//                     un archivo») o carpetas de proyecto de Revo Scan 5 (se
//                     empaquetan en ZIP). Se suben cuando llevan un rato sin
//                     cambiar (Revo Scan ha terminado de escribir).
//   carpeta         → mesh exportados a mano (.stl/.obj/.ply…), por si el
//                     profesional prefiere exportar; van comprimidos con gzip.
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
const { zipCarpeta } = require("./zip");

const CONFIG_PATH = path.resolve(process.argv[2] || path.join(__dirname, "puente.config.json"));
const ESTADO_PATH = path.join(__dirname, "puente-estado.json");

// Mesh exportados (se comprimen con gzip al subir).
const MESH_EXTS = [".stl", ".obj", ".ply", ".glb", ".gltf", ".3mf", ".asc"];
// Archivo de escaneo de Revo Scan 6 (ya va comprimido: se sube tal cual).
const RAW_EXTS = [".revox"];
// Carpeta de proyecto de Revo Scan 5: la que contiene su índice .revo.
const PROJECT_INDEX = /\.revo$/i;

const CICLO_MS = 5000;
const SALUDO_MS = 60000;
// Un mesh se sube cuando lleva dos vueltas con el mismo tamaño. Un escaneo en
// bruto, cuando lleva este tiempo sin cambiar nada: Revo Scan escribe muchos
// archivos mientras se escanea y al parar.
const ESTABLE_BRUTO_MS = Number(process.env.ORTOSEND_ESTABLE_MS || 45000);

function log(...args) {
  console.log(new Date().toLocaleTimeString("es-ES"), ...args);
}

function carpetaRevoScanPorDefecto() {
  const candidatos =
    process.platform === "win32"
      ? [path.join(process.env.APPDATA || "", "RevoScan5", "Projects")]
      : [path.join(os.homedir(), "Library", "Application Support", "RevoScan5", "Projects")];
  return candidatos.find((c) => c && fs.existsSync(c)) || "";
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
  // El Bloc de notas y PowerShell pueden guardar el JSON con BOM: se quita.
  const cfg = JSON.parse(raw.replace(/^\uFEFF/, ""));
  const servidor = (process.env.ORTOSEND_URL || cfg.servidor || "").replace(/\/+$/, "");
  const token = process.env.ORTOSEND_TOKEN || cfg.token || "";
  const carpeta = process.env.ORTOSEND_CARPETA || cfg.carpeta || "";
  const carpetaRevoScan = process.env.ORTOSEND_CARPETA_REVOSCAN || cfg.carpetaRevoScan || carpetaRevoScanPorDefecto();
  if (!servidor || !token) {
    console.error("Faltan datos en la configuración: servidor y token son obligatorios.");
    process.exit(1);
  }
  if (!carpeta && !carpetaRevoScan) {
    console.error("Indica carpetaRevoScan (escaneos de Revo Scan) y/o carpeta (mesh exportados).");
    process.exit(1);
  }
  return { servidor, token, carpeta, carpetaRevoScan };
}

// Lo ya subido, por firma (ruta + tamaño + fecha): no se repite al reiniciar y
// un escaneo que cambie después se vuelve a subir como versión nueva.
// La primera vez (sin estado) se anota cuándo se instaló: lo escaneado más
// de PRIMERA_VEZ_HORAS antes se da por visto y no se sube, para no volcar de
// golpe todo el historial de la clínica.
const PRIMERA_VEZ_HORAS = 24;
function leerEstado() {
  let estado;
  try {
    estado = JSON.parse(fs.readFileSync(ESTADO_PATH, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    estado = { subidos: {} };
  }
  // Estado de una versión anterior (sin fecha de instalación): cuenta desde hoy.
  if (!estado.instaladoEn) estado.instaladoEn = Date.now();
  if (!estado.subidos) estado.subidos = {};
  return estado;
}
function demasiadoAntiguo(estado, mtime) {
  return !!estado.instaladoEn && mtime < estado.instaladoEn - PRIMERA_VEZ_HORAS * 3600 * 1000;
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

// --- Qué hay que subir ---------------------------------------------------

async function* archivosCon(dir, exts) {
  let entradas;
  try {
    entradas = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entradas) {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) yield* archivosCon(completo, exts);
    else if (exts.includes(path.extname(e.name).toLowerCase())) yield completo;
  }
}

// Firma de una carpeta: bytes totales y última modificación de todo lo que hay dentro.
async function firmaCarpeta(dir) {
  let bytes = 0;
  let mtime = 0;
  let archivos = 0;
  // Un proyecto copiado o duplicado conserva la fecha de sus archivos, pero la
  // carpeta nueva tiene fecha de creación de ahora: cuenta como reciente.
  let creado = 0;
  try {
    creado = (await fsp.stat(dir)).birthtimeMs || 0;
  } catch {
    // sin fecha de creación
  }
  async function rec(d) {
    let entradas;
    try {
      entradas = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await rec(p);
      else {
        try {
          const st = await fsp.stat(p);
          bytes += st.size;
          mtime = Math.max(mtime, st.mtimeMs);
          archivos++;
        } catch {
          // borrado entre medias
        }
      }
    }
  }
  await rec(dir);
  return { bytes, mtime: Math.round(mtime), archivos, reciente: Math.max(mtime, creado) };
}

// Escaneos en bruto en la carpeta de Revo Scan. No se depende de cómo la
// organiza cada versión de Revo Scan: en el primer nivel, cualquier carpeta
// es un escaneo (va en zip) y cualquier archivo de más de MIN_ARCHIVO también
// (Revo Scan 6 guarda «un escaneo, un archivo»). Si la carpeta vigilada es un
// nivel por encima (p. ej. contiene "Projects"), se baja hasta encontrar las
// carpetas que llevan su índice .revo.
const MIN_ARCHIVO = 200 * 1024;
const IGNORAR = /^(desktop\.ini|thumbs\.db|\.ds_store|.*\.(txt|log|ini|json|xml|tmp|lnk))$/i;
async function escaneosEnBruto(dir) {
  const out = [];
  let entradas;
  try {
    entradas = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entradas) {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) {
      let hijos = [];
      try {
        hijos = await fsp.readdir(completo, { withFileTypes: true });
      } catch {
        continue;
      }
      const tieneIndice = hijos.some((h) => h.isFile() && PROJECT_INDEX.test(h.name));
      // Carpeta contenedora (p. ej. "Projects"): dentro hay carpetas con .revo
      const contenedora = !tieneIndice && (await esContenedora(completo, hijos));
      if (contenedora) out.push(...(await escaneosEnBruto(completo)));
      else out.push({ tipo: "proyecto", ruta: completo });
    } else if (e.isFile() && !IGNORAR.test(e.name)) {
      try {
        const st = await fsp.stat(completo);
        if (st.size >= MIN_ARCHIVO || RAW_EXTS.includes(path.extname(e.name).toLowerCase()))
          out.push({ tipo: "archivo", ruta: completo });
      } catch {
        // borrado entre medias
      }
    }
  }
  return out;
}
async function esContenedora(dir, hijos) {
  for (const h of hijos) {
    if (!h.isDirectory()) continue;
    try {
      const nietos = await fsp.readdir(path.join(dir, h.name));
      if (nietos.some((n) => PROJECT_INDEX.test(n))) return true;
    } catch {
      // sin acceso
    }
  }
  return false;
}

// Nombre del proyecto tal y como lo tecleó el profesional en Revo Scan: se
// busca en el índice .revo (JSON) y, si no, se usa el nombre de la carpeta o
// del archivo. Con él el servidor asocia el escaneo al paciente.
async function nombreProyecto(esc) {
  const base = path.basename(esc.ruta).replace(/\.[^.]+$/, "");
  if (esc.tipo !== "proyecto") return base;
  try {
    const hijos = await fsp.readdir(esc.ruta);
    const idx = hijos.find((h) => PROJECT_INDEX.test(h));
    if (!idx) return base;
    const json = JSON.parse((await fsp.readFile(path.join(esc.ruta, idx), "utf8")).replace(/^\uFEFF/, ""));
    const claves = ["name", "projectName", "project_name", "ProjectName", "title", "displayName", "alias"];
    const buscar = (o, nivel = 0) => {
      if (!o || typeof o !== "object" || nivel > 3) return null;
      for (const k of claves) if (typeof o[k] === "string" && o[k].trim()) return o[k].trim();
      for (const v of Object.values(o)) {
        const r = buscar(v, nivel + 1);
        if (r) return r;
      }
      return null;
    };
    return buscar(json) || base;
  } catch {
    return base;
  }
}

// --- Subida ---------------------------------------------------------------

async function comprimir(archivo) {
  const tmp = path.join(os.tmpdir(), `ortosend-${process.pid}-${Date.now()}.gz`);
  await pipeline(fs.createReadStream(archivo), zlib.createGzip({ level: 6 }), fs.createWriteStream(tmp));
  return { tmp, bytes: (await fsp.stat(tmp)).size };
}

// Subida directa al almacén (R2) con URL firmada: el archivo no pasa por el
// servidor de Ortosend, así que no hay límite de tamaño. Si el servidor no
// tiene R2, lo manda entero por /api/scan/ingest.
async function subirArchivo(cfg, { rutaLocal, nombre, bytesOriginal, encoding, proyecto }) {
  const bytesAlmacenados = (await fsp.stat(rutaLocal)).size;
  const plan = await api(cfg, "/api/scan/subida", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre, bytes: bytesOriginal, proyecto, ...(encoding ? { encoding, storedBytes: bytesAlmacenados } : {}) }),
  });
  if (!plan.ok) return plan;

  if (plan.cuerpo.modo === "directo") {
    const res = await fetch(plan.cuerpo.url, {
      method: "PUT",
      headers: { ...(plan.cuerpo.headers || {}), "Content-Length": String(bytesAlmacenados) },
      body: fs.createReadStream(rutaLocal),
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

  if (bytesAlmacenados > plan.cuerpo.maxBytes)
    return {
      ok: false,
      status: 413,
      cuerpo: { error: `Sin almacén R2 el servidor no admite más de ${(plan.cuerpo.maxBytes / 1048576).toFixed(0)} MB` },
    };
  const form = new FormData();
  form.append("nombre", nombre);
  form.append("bytes", String(bytesOriginal));
  if (proyecto) form.append("proyecto", proyecto);
  if (encoding) form.append("encoding", encoding);
  form.append("file", new Blob([await fsp.readFile(rutaLocal)]), nombre);
  return api(cfg, "/api/scan/ingest", { method: "POST", body: form });
}

const MB = (b) => `${(b / 1048576).toFixed(1)} MB`;

function anotar(estado, clave, r, etiqueta) {
  if (r.ok) {
    estado.subidos[clave] = { at: new Date().toISOString(), caso: r.cuerpo?.caso ?? null };
    guardarEstado(estado);
    if (r.cuerpo?.caso) log(`✓ ${etiqueta} asociado al caso #${r.cuerpo.caso} — ${r.cuerpo.paciente}`);
    else log(`✓ ${etiqueta} subido. Nadie esperaba escaneo: queda en la bandeja para confirmarlo desde el asistente.`);
    return true;
  }
  if (r.status === 400 || r.status === 413 || r.status === 415) {
    // Formato o tamaño que este servidor nunca va a aceptar: no se reintenta.
    estado.subidos[clave] = { at: new Date().toISOString(), descartado: r.cuerpo?.error ?? r.status };
    guardarEstado(estado);
    log(`✗ Descartado ${etiqueta}: ${r.cuerpo?.error ?? `HTTP ${r.status}`}`);
    return true;
  }
  // 401 (token revocado), 409 (llegó incompleto), 5xx: se reintenta en la
  // siguiente vuelta por si es algo pasajero.
  log(`✗ ${etiqueta}: ${r.cuerpo?.error ?? `HTTP ${r.status}`}. Se reintenta.`);
  return false;
}

// Mesh exportados: se suben cuando el tamaño deja de crecer.
async function cicloMesh(cfg, estado, tamanos) {
  for await (const archivo of archivosCon(cfg.carpeta, MESH_EXTS)) {
    const ruta = path.resolve(archivo);
    let st;
    try {
      st = await fsp.stat(archivo);
    } catch {
      continue;
    }
    const clave = `${ruta}|${st.size}|${Math.round(st.mtimeMs)}`;
    if (estado.subidos[clave]) continue;
    if (demasiadoAntiguo(estado, Math.max(st.mtimeMs, st.birthtimeMs || 0))) {
      estado.subidos[clave] = { at: new Date().toISOString(), descartado: "anterior a la instalación" };
      guardarEstado(estado);
      continue;
    }
    if (tamanos.get(ruta) !== st.size) {
      tamanos.set(ruta, st.size);
      continue;
    }
    const nombre = path.basename(archivo);
    log(`Subiendo mesh ${nombre} (${MB(st.size)})…`);
    const gz = await comprimir(archivo);
    try {
      log(`  comprimido: ${MB(st.size)} → ${MB(gz.bytes)}`);
      const r = await subirArchivo(cfg, { rutaLocal: gz.tmp, nombre, bytesOriginal: st.size, encoding: "gzip", proyecto: nombre.replace(/\.[^.]+$/, "") });
      anotar(estado, clave, r, nombre);
    } catch (e) {
      log(`Fallo de red al subir ${nombre}: ${e.message}. Se reintenta.`);
    } finally {
      await fsp.rm(gz.tmp, { force: true });
    }
  }
}

// Escaneos en bruto de Revo Scan: se suben cuando llevan un rato sin cambiar.
async function cicloBruto(cfg, estado, vistos) {
  for (const esc of await escaneosEnBruto(cfg.carpetaRevoScan)) {
    const firma = esc.tipo === "proyecto" ? await firmaCarpeta(esc.ruta) : await firmaArchivo(esc.ruta);
    if (!firma || firma.bytes === 0) continue;
    const clave = `${esc.ruta}|${firma.bytes}|${firma.mtime}`;
    if (estado.subidos[clave]) continue;
    const proyecto = await nombreProyecto(esc);
    if (demasiadoAntiguo(estado, firma.reciente)) {
      estado.subidos[clave] = { at: new Date().toISOString(), descartado: "anterior a la instalación" };
      guardarEstado(estado);
      continue;
    }
    // Espera a que nada cambie durante ESTABLE_BRUTO_MS.
    const visto = vistos.get(esc.ruta);
    if (!visto || visto.clave !== clave) {
      if (!visto) log(`Detectado ${esc.tipo} "${proyecto}" (${path.basename(esc.ruta)}, ${MB(firma.bytes)}): esperando a que Revo Scan termine de escribirlo...`);
      vistos.set(esc.ruta, { clave, desde: Date.now() });
      continue;
    }
    if (Date.now() - visto.desde < ESTABLE_BRUTO_MS) continue;

    const nombreBase = path.basename(esc.ruta);
    if (esc.tipo === "proyecto") {
      const tmp = path.join(os.tmpdir(), `ortosend-${process.pid}-${Date.now()}.zip`);
      try {
        log(`Empaquetando proyecto ${nombreBase} (${firma.archivos} archivos, ${MB(firma.bytes)})…`);
        const bytesZip = await zipCarpeta(esc.ruta, tmp);
        log(`  zip: ${MB(bytesZip)}. Subiendo…`);
        const r = await subirArchivo(cfg, { rutaLocal: tmp, nombre: `${nombreBase}.zip`, bytesOriginal: bytesZip, encoding: null, proyecto });
        anotar(estado, clave, r, `proyecto ${nombreBase}`);
      } catch (e) {
        log(`Fallo al subir el proyecto ${nombreBase}: ${e.message}. Se reintenta.`);
      } finally {
        await fsp.rm(tmp, { force: true });
      }
    } else {
      try {
        log(`Subiendo escaneo ${nombreBase} (${MB(firma.bytes)})…`);
        const r = await subirArchivo(cfg, { rutaLocal: esc.ruta, nombre: nombreBase, bytesOriginal: firma.bytes, encoding: null, proyecto });
        anotar(estado, clave, r, nombreBase);
      } catch (e) {
        log(`Fallo al subir ${nombreBase}: ${e.message}. Se reintenta.`);
      }
    }
  }
}

async function firmaArchivo(ruta) {
  try {
    const st = await fsp.stat(ruta);
    return { bytes: st.size, mtime: Math.round(st.mtimeMs), archivos: 1, reciente: Math.max(st.mtimeMs, st.birthtimeMs || 0) };
  } catch {
    return null;
  }
}

async function main() {
  const cfg = leerConfig();
  const estado = leerEstado();
  guardarEstado(estado); // fija instaladoEn la primera vez
  const tamanos = new Map();
  const vistos = new Map();
  log(`Puente de escaneo Ortosend`);
  log(`Servidor: ${cfg.servidor}`);
  if (cfg.carpetaRevoScan) log(`Escaneos de Revo Scan: ${cfg.carpetaRevoScan}`);
  if (cfg.carpeta) {
    log(`Mesh exportados: ${cfg.carpeta}`);
    await fsp.mkdir(cfg.carpeta, { recursive: true });
  }

  let hola = null;
  try {
    hola = await saludar(cfg);
  } catch (e) {
    log(`Sin conexión con el servidor (${e.message}). Se sigue intentando.`);
  }
  if (hola)
    log(
      `Clínica: ${hola.clinica} · modo ${hola.modo === "directo" ? "directo al almacén (sin límite de tamaño)" : `servidor (máx. ${(hola.maxBytes / 1048576).toFixed(0)} MB)`}`
    );
  setInterval(() => saludar(cfg).catch((e) => log("Error:", e.message)), SALUDO_MS);

  if (cfg.carpetaRevoScan) {
    let entradas = [];
    try {
      entradas = await fsp.readdir(cfg.carpetaRevoScan, { withFileTypes: true });
    } catch {
      log(`AVISO: la carpeta de Revo Scan no existe o no se puede leer: ${cfg.carpetaRevoScan}`);
    }
    log(`Dentro de la carpeta de Revo Scan hay ${entradas.length} elemento(s):`);
    for (const e of entradas.slice(0, 12)) log(`   ${e.isDirectory() ? "[carpeta]" : "[archivo]"} ${e.name}`);
    if (entradas.length > 12) log(`   ... y ${entradas.length - 12} más`);
    const vistosAhora = await escaneosEnBruto(cfg.carpetaRevoScan);
    log(`Escaneos reconocidos: ${vistosAhora.length}. Lo anterior a la instalación no se sube; lo nuevo, en cuanto lleve ${ESTABLE_BRUTO_MS / 1000} s sin cambios.`);
  }

  // Bucle secuencial: nunca hay dos subidas a la vez desde el mismo PC.
  for (;;) {
    try {
      if (cfg.carpetaRevoScan) await cicloBruto(cfg, estado, vistos);
      if (cfg.carpeta) await cicloMesh(cfg, estado, tamanos);
    } catch (e) {
      log("Error en el ciclo:", e.message);
    }
    await new Promise((r) => setTimeout(r, CICLO_MS));
  }
}

main();
