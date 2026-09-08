// ZIP mínimo sin dependencias: empaqueta una carpeta (proyecto de Revo Scan 5)
// en un .zip normal que el taller abre con doble clic. Deflate por archivo,
// CRC-32 y descriptor de datos; sin zip64 (proyectos < 4 GB).
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf, crc = 0) {
  crc = ~crc;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function* archivosDe(dir, base = "") {
  const entradas = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entradas) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) yield* archivosDe(abs, rel);
    else if (e.isFile()) yield { abs, rel };
  }
}

function escribir(stream, buf) {
  return new Promise((resolve, reject) => {
    stream.write(buf, (err) => (err ? reject(err) : resolve()));
  });
}

// Empaqueta `carpeta` (con su propio nombre como raíz) en `destino`.
async function zipCarpeta(carpeta, destino) {
  const raiz = path.basename(carpeta);
  const out = fs.createWriteStream(destino);
  const central = [];
  let offset = 0;

  for await (const { abs, rel } of archivosDe(carpeta, raiz)) {
    const st = await fsp.stat(abs);
    const nombre = Buffer.from(rel, "utf8");
    const { time, date } = dosDateTime(st.mtime);
    const localOffset = offset;

    // Cabecera local con bit 3 (tamaños y CRC van después, en el descriptor).
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0808, 6); // bit 3 descriptor + bit 11 UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt16LE(nombre.length, 26);
    await escribir(out, local);
    await escribir(out, nombre);
    offset += 30 + nombre.length;

    let crc = 0;
    let sizeRaw = 0;
    let sizeComp = 0;
    const deflate = zlib.createDeflateRaw({ level: 6 });
    const lectura = fs.createReadStream(abs);
    lectura.on("data", (chunk) => {
      crc = crc32(chunk, crc);
      sizeRaw += chunk.length;
    });
    await new Promise((resolve, reject) => {
      deflate.on("data", (chunk) => {
        sizeComp += chunk.length;
        if (!out.write(chunk)) deflate.pause(), out.once("drain", () => deflate.resume());
      });
      deflate.on("end", resolve);
      deflate.on("error", reject);
      lectura.on("error", reject);
      lectura.pipe(deflate);
    });
    offset += sizeComp;

    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc, 4);
    desc.writeUInt32LE(sizeComp, 8);
    desc.writeUInt32LE(sizeRaw, 12);
    await escribir(out, desc);
    offset += 16;

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0808, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(sizeComp, 20);
    cd.writeUInt32LE(sizeRaw, 24);
    cd.writeUInt16LE(nombre.length, 28);
    cd.writeUInt32LE(localOffset, 42);
    central.push(Buffer.concat([cd, nombre]));
  }

  const cdStart = offset;
  for (const c of central) {
    await escribir(out, c);
    offset += c.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  await escribir(out, eocd);
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  return (await fsp.stat(destino)).size;
}

module.exports = { zipCarpeta };
