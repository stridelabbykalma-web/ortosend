// Lectura de etiquetas GS1 (el estándar de los códigos de barras de productos sanitarios y materiales):
// GS1-128, GS1 DataMatrix o QR con identificadores de aplicación (AI). Saca lo necesario para la
// trazabilidad: GTIN (01), lote (10), caducidad (17), fecha de fabricación (11) y nº de serie (21).
// Vale para el texto tal como lo lee el lector (con el separador GS, carácter 29) y para el texto
// legible de la etiqueta con paréntesis: «(01)08412345678905(17)261231(10)AB123».

export type DatosEtiqueta = {
  esGs1: boolean;
  gtin?: string;
  lote?: string;
  caducidad?: string; // AAAA-MM-DD
  fabricacion?: string; // AAAA-MM-DD
  serie?: string;
};

const GS = "\u001d";
// AI de longitud fija (sin contar el propio AI).
const FIJOS: Record<string, number> = { "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 };
// AI de longitud variable que se conocen (terminan en GS o al final).
const VARIABLES = ["10", "21", "22", "30", "37", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "240", "241", "250", "251", "400", "401", "403", "710", "711", "712", "713"];

function fecha(aammdd: string): string | undefined {
  if (!/^\d{6}$/.test(aammdd)) return undefined;
  const a = 2000 + Number(aammdd.slice(0, 2));
  const m = Number(aammdd.slice(2, 4));
  let d = Number(aammdd.slice(4, 6));
  if (m < 1 || m > 12) return undefined;
  if (d === 0) d = new Date(Date.UTC(a, m, 0)).getUTCDate(); // día 00 = último del mes
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function aDatos(campos: Record<string, string>): DatosEtiqueta {
  const d: DatosEtiqueta = { esGs1: Object.keys(campos).length > 0 };
  if (campos["01"] ?? campos["02"]) d.gtin = (campos["01"] ?? campos["02"]).trim();
  if (campos["10"]) d.lote = campos["10"].trim();
  if (campos["17"]) d.caducidad = fecha(campos["17"]);
  if (campos["11"]) d.fabricacion = fecha(campos["11"]);
  if (campos["21"]) d.serie = campos["21"].trim();
  return d;
}

export function leerEtiqueta(texto: string): DatosEtiqueta {
  let t = (texto ?? "").trim().replace(/<GS>|\{GS\}|\\x1d/gi, GS);
  const conPrefijo = /^\][A-Za-z]\d/.test(t);
  t = t.replace(/^\][A-Za-z]\d/, ""); // prefijo de simbología (]C1, ]d2, ]Q3…)
  // Texto legible con paréntesis.
  if (/^\(\d{2,4}\)/.test(t)) {
    const campos: Record<string, string> = {};
    for (const m of t.matchAll(/\((\d{2,4})\)([^(]*)/g)) campos[m[1]] = m[2].replace(/\s+$/, "");
    return aDatos(campos);
  }
  // Datos en bruto: AI + valor, uno tras otro. Sin prefijo ni separadores, solo se acepta si empieza por
  // un GTIN (01/02/00), para no confundir un código cualquiera (p. ej. un EAN que empiece por 10) con GS1.
  if (!conPrefijo && !t.includes(GS) && !/^(00|01|02)/.test(t)) return aDatos({});
  const campos: Record<string, string> = {};
  let i = t.startsWith(GS) ? 1 : 0;
  while (i < t.length) {
    const dos = t.slice(i, i + 2);
    const tres = t.slice(i, i + 3);
    if (dos in FIJOS) {
      const valor = t.slice(i + 2, i + 2 + FIJOS[dos]);
      if (valor.length !== FIJOS[dos] || !/^\d+$/.test(valor)) return aDatos({});
      campos[dos] = valor;
      i += 2 + FIJOS[dos];
    } else if (VARIABLES.includes(tres) || VARIABLES.includes(dos)) {
      const ai = VARIABLES.includes(tres) ? tres : dos;
      const fin = t.indexOf(GS, i + ai.length);
      const hasta = fin === -1 ? t.length : fin;
      campos[ai] = t.slice(i + ai.length, hasta);
      i = hasta;
    } else {
      return aDatos({}); // no es GS1 (o un AI que no se conoce): se guarda el texto tal cual
    }
    if (t[i] === GS) i++;
  }
  return aDatos(campos);
}
