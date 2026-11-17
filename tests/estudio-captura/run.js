// Batería del estudio de captura con vídeos reales como cámara falsa de Chromium.
// Recorre el flujo real: login del equipo → caso → paso del protocolo → MediaPipe →
// arranque automático → grabación → subida → base de datos. Ver README.md.
//
//   BASE_URL=http://localhost:3000 CASE_ID=... DATABASE_URL=... node tests/estudio-captura/run.js [escenarios]
//   COLLECT=1  → solo recoge la traza de puntos ~25 s por escenario, sin juzgar.
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CASE = process.env.CASE_ID;
const DB = process.env.DATABASE_URL;
const USER = process.env.STUDIO_USER || "profesionalreceta@ortosend.com";
const PASS = process.env.STUDIO_PASS || "ortosend123";
if (!CASE || !DB) {
  console.error("Faltan CASE_ID y/o DATABASE_URL (ver README.md)");
  process.exit(2);
}
const HERE = __dirname;
const CAMS = path.join(HERE, "clips");
const OUT = path.join(HERE, "out");
fs.mkdirSync(OUT, { recursive: true });
const psql = (sql) => execFileSync("psql", [DB, "-tAc", sql]).toString().trim();
const COLLECT = !!process.env.COLLECT;

// Pasos del protocolo (?paso=): 11 vídeo posterior, 12 anterior, 13 foto posterior, 14 foto anterior
const ALL = [
  { name: "post_ok", cam: "post_4889.mjpeg", paso: 11, kind: "video_post_descalzo", expect: "record" },
  { name: "post_23378", cam: "post_23378.mjpeg", paso: 11, kind: "video_post_descalzo", expect: "record" },
  { name: "ant_32623", cam: "ant_32623.mjpeg", paso: 12, kind: "video_ant_descalzo", expect: "record" },
  { name: "post_rot180", cam: "post_4889_rot180.mjpeg", paso: 11, kind: "video_post_descalzo", expect: "record" },
  { name: "post_rot90", cam: "post_4889_rot90.mjpeg", paso: 11, kind: "video_post_descalzo", expect: "record" },
  { name: "post_rot270", cam: "post_4889_rot270.mjpeg", paso: 11, kind: "video_post_descalzo", expect: "record" },
  { name: "post_wrong_orient", cam: "ant_32623.mjpeg", paso: 11, kind: "video_post_descalzo", expect: "no_record" },
  { name: "lat_4888", cam: "lat_4888.mjpeg", paso: 12, kind: "video_ant_descalzo", expect: "no_record" },
  { name: "nobody", cam: "nobody_40656.mjpeg", paso: 11, kind: "video_post_descalzo", expect: "no_record" },
  { name: "post_feet_cut", cam: "post_32748.mjpeg", paso: 11, kind: "video_post_descalzo", expect: "no_record" },
  { name: "ant_far", cam: "ant_far_35830.mjpeg", paso: 12, kind: "video_ant_descalzo", expect: "no_record" }, // límite conocido del modelo
  // Foto posterior con solo piernas y pies: botón manual + marcado a mano de Helbing/Perthes
  { name: "foto_manual", cam: "foto_crop_4889.mjpeg", paso: 13, kind: "foto_posterior", expect: "photo_manual" },
];
const only = process.argv.slice(2);
const SCENARIOS = only.length ? ALL.filter((s) => only.includes(s.name)) : ALL;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page) {
  await page.goto(`${BASE}/equipo`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="identifier"]', USER);
  await page.fill('input[name="password"]', PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/equipo") && !u.pathname.startsWith("/login"), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
}

// Marcado manual: 6 toques (pantorrilla, tobillo, talón × pierna dcha. e izq.)
// en posiciones relativas de la foto; en el clip recortado las piernas están centradas.
const TOQUES = [
  [0.56, 0.3], [0.55, 0.72], [0.55, 0.9],
  [0.46, 0.3], [0.47, 0.72], [0.47, 0.9],
];

async function runScenario(sc) {
  const res = { name: sc.name, cam: sc.cam, kind: sc.kind, expect: sc.expect, phases: [], events: [], consoleErrors: [], ok: null };
  psql(`delete from "MediaAsset" where kind='${sc.kind}' and "captureId" in (select id from "Capture" where "caseId"='${CASE}')`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${path.join(CAMS, sc.cam)}`,
      "--autoplay-policy=no-user-gesture-required",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["camera"] });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") res.consoleErrors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => res.consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
  const t0 = Date.now();
  const ev = (txt) => res.events.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${txt}`);
  try {
    await login(page);
    ev("login ok");
    await page.goto(`${BASE}/caso/${CASE}?paso=${sc.paso}&studioDebug=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".studio", { timeout: 20000 });
    ev("estudio abierto");
    // Avisos que tapan la parte baja de la pantalla (cookies y "estudio en otro
    // dispositivo", este último porque cada escenario abre otro navegador)
    const cerrar = async () => {
      for (const t of ["Solo esenciales", "Seguir aquí"]) {
        const b = page.locator(`button:has-text("${t}")`).first();
        if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
      }
    };
    await cerrar();
    const log = [];
    let lastLen = 0, clickedUpload = false, shots = 0, recStart = null, shot = false, marked = false, finished = false;
    const timeout = COLLECT ? 25000 : sc.expect === "no_record" ? 40000 : 110000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      let st = null;
      try {
        st = await page.evaluate((from) => {
          const l = window.__studioLog || [];
          const txt = document.body.innerText;
          return {
            n: l.length, fresh: l.slice(from), url: location.href,
            review: /Usar y subir/.test(txt), live: !!document.querySelector(".studio-shutter"),
            marcarBtn: /Marcar los puntos a mano|Corregir los puntos a mano/.test(txt), marcando: !!document.querySelector(".studio-mark"),
            helbingTxt: (txt.match(/Línea de Helbing[^\n]*/) || [""])[0].slice(0, 160),
            fatal: (document.querySelector(".studio .note.r")?.textContent || "").slice(0, 200),
          };
        }, lastLen);
      } catch (e) { res.events.push(`eval error ${String(e).slice(0, 100)}`); }
      if (st) {
        if (st.n < lastLen) lastLen = 0;
        for (const e of st.fresh) {
          log.push(e);
          if (!res.phases.includes(e.phase)) { res.phases.push(e.phase); ev(`fase → ${e.phase} (rot ${e.rot}, rect ${e.rect ? e.rect.w + "x" + e.rect.h : "-"})`); }
          if (e.phase === "recording" && recStart === null) recStart = Date.now();
        }
        lastLen = st.n;
        if (st.fatal && !res.fatal) { res.fatal = st.fatal; ev(`aviso rojo: ${st.fatal}`); }
        if (recStart !== null && shots < 3 && Date.now() - recStart > [800, 5000, 9200][shots]) {
          await page.screenshot({ path: path.join(OUT, `${sc.name}_rec${shots + 1}.png`) }).catch(() => {}); shots++;
        }
        if (sc.expect === "photo_manual" && !COLLECT) {
          // 1) botón manual tras unos segundos en directo; 2) marcar a mano; 3) subir
          if (st.live && !shot && log.length > 15) {
            await page.click(".studio-shutter"); shot = true; ev("pulso «Hacer la foto»");
          } else if (st.review && shot && !marked && st.marcarBtn && !st.marcando) {
            await page.screenshot({ path: path.join(OUT, `${sc.name}_review_sin_lineas.png`) }).catch(() => {});
            ev(`revisión: líneas automáticas ${st.helbingTxt ? "SÍ" : "no"} → pulso «Marcar los puntos a mano»`);
            await cerrar();
            await page.click("button:has-text('puntos a mano')");
            const box = await (await page.waitForSelector(".studio-mark", { timeout: 5000 })).boundingBox();
            for (const [fx, fy] of TOQUES) {
              await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
              await sleep(150);
            }
            marked = true; ev("6 toques hechos");
            await sleep(400);
            await page.screenshot({ path: path.join(OUT, `${sc.name}_review_marcado.png`) }).catch(() => {});
          } else if (st.review && marked && !clickedUpload && !st.marcando) {
            res.helbingTxt = st.helbingTxt; ev(`líneas tras marcar: ${st.helbingTxt || "(ninguna)"} → «Usar y subir»`);
            await page.click(".studio button.pri:has-text('Usar y subir')"); clickedUpload = true;
          }
        } else if (st.review && !clickedUpload && !COLLECT) {
          await page.screenshot({ path: path.join(OUT, `${sc.name}_review.png`) }).catch(() => {});
          ev("revisión: pulso «Usar y subir»");
          await page.click(".studio button.pri:has-text('Usar y subir')").catch((e) => ev(`click fallo ${e}`));
          clickedUpload = true;
        }
        if (clickedUpload && !st.url.includes(`paso=${sc.paso}&`) && !st.url.endsWith(`paso=${sc.paso}`)) {
          ev(`navegó a ${st.url.replace(BASE, "")}`); finished = true; break;
        }
      }
      await sleep(350);
    }
    if (!finished) { await page.screenshot({ path: path.join(OUT, `${sc.name}_final.png`) }).catch(() => {}); ev("tiempo agotado"); }
    res.log = log;
    fs.writeFileSync(path.join(OUT, `${sc.name}_log.json`), JSON.stringify(log));
    await sleep(1500);
    const row = psql(
      `select id, "confirmedAt", "sizeBytes", (meta - 'marcha') || jsonb_build_object('marcha_frames', jsonb_array_length(coalesce(meta->'marcha'->'track'->'frames','[]'::jsonb)), 'informe', meta->'marcha'->'informe') from "MediaAsset" where kind='${sc.kind}' and "captureId" in (select id from "Capture" where "caseId"='${CASE}')`
    );
    res.db = row || null;
    if (row && !COLLECT) {
      try {
        res.extract = execFileSync(path.join(HERE, "extract_media.sh"), [sc.kind, `${sc.name}_media`], { env: { ...process.env, CASE_ID: CASE } }).toString().trim();
      } catch (e) { res.extract = `extract error ${String(e).slice(0, 200)}`; }
    }
    const recorded = res.phases.includes("recording");
    if (sc.expect === "record") res.ok = recorded && !!row && /\d{4}-\d{2}-\d{2}/.test(row);
    else if (sc.expect === "photo_manual") res.ok = !!row && /"manual": true/.test(row) && /helbing/.test(row) && /perthes/.test(row);
    else res.ok = !recorded && !res.phases.includes("countdown");
  } catch (e) {
    res.error = String(e).slice(0, 500);
    await page.screenshot({ path: path.join(OUT, `${sc.name}_error.png`) }).catch(() => {});
  } finally {
    await browser.close();
  }
  return res;
}

(async () => {
  const results = [];
  for (const sc of SCENARIOS) {
    console.log(`\n=== ${sc.name} (${sc.cam} → ${sc.kind}, esperado: ${sc.expect})`);
    const r = await runScenario(sc);
    for (const e of r.events) console.log("  ", e);
    if (r.error) console.log("   ERROR", r.error);
    console.log("   fases:", r.phases.join(" → "), "| frames traza:", r.log?.length ?? 0);
    console.log("   db:", (r.db || "sin fila").slice(0, 500));
    if (r.extract) console.log("   archivo:", r.extract.replace(/\n/g, " | "));
    if (r.consoleErrors.length) console.log("   consola:", r.consoleErrors.slice(0, 3));
    console.log("   RESULTADO:", r.ok ? "OK" : "FALLO");
    results.push({ ...r, log: undefined });
  }
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const fallos = results.filter((r) => !r.ok).map((r) => r.name);
  console.log(`\n${results.length - fallos.length}/${results.length} OK${fallos.length ? " · fallan: " + fallos.join(", ") : ""}`);
  process.exit(fallos.length ? 1 : 0);
})();
