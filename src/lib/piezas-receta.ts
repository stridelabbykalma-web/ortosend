// Piezas que el prescriptor puede marcar en la receta para cada pie. Son las mismas que el programa del
// taller (Ortosend Taller) aplica al molde, con sus valores por defecto para plantilla RÍGIDA: al asociar
// el pedido, el técnico las tiene ya puestas y solo las revisa. El texto libre de la receta sigue igual.

export type PiezaReceta = {
  tipo: string;
  nombre: string;
  unidad: "mm" | "°" | "%";
  defecto: number;
  min: number;
  max: number;
  sentidos?: [string, string][]; // [valor, texto]; el primero es el de por defecto
};

const CERRADA_ABIERTA = (borde: string): [string, string][] => [
  ["cerrada", "Cerrada"],
  ["abierta", `Abierta al borde ${borde}`],
];
const VARO_VALGO: [string, string][] = [
  ["varo", "Varo"],
  ["valgo", "Valgo"],
];

export const PIEZAS_RECETA: PiezaReceta[] = [
  { tipo: "oliva", nombre: "Oliva retrocapital", unidad: "mm", defecto: 3, min: 1, max: 8 },
  { tipo: "barra", nombre: "Barra metatarsal", unidad: "mm", defecto: 3, min: 1, max: 8 },
  { tipo: "descarga_1mtt", nombre: "Descarga 1.er MTT", unidad: "mm", defecto: 2.5, min: 1, max: 5, sentidos: CERRADA_ABIERTA("interno") },
  { tipo: "descarga_sesamoideos", nombre: "Descarga sesamoideos", unidad: "mm", defecto: 2, min: 1, max: 5, sentidos: CERRADA_ABIERTA("interno") },
  { tipo: "descarga_5mtt", nombre: "Descarga 5.º MTT", unidad: "mm", defecto: 2, min: 1, max: 5, sentidos: CERRADA_ABIERTA("externo") },
  { tipo: "cuna_ant", nombre: "Cuña anterior", unidad: "°", defecto: 2, min: 1, max: 6, sentidos: VARO_VALGO },
  { tipo: "arco", nombre: "Relleno de arco", unidad: "mm", defecto: 2, min: 1, max: 6, sentidos: [["rebajar", "Rebajar arco"], ["subir", "Subir arco"]] },
  { tipo: "navicular", nombre: "Soporte navicular", unidad: "mm", defecto: 2, min: 1, max: 6 },
  { tipo: "cuboides", nombre: "Soporte cuboides", unidad: "mm", defecto: 2, min: 1, max: 6 },
  { tipo: "canal_fascia", nombre: "Canal fascia plantar", unidad: "mm", defecto: 2.5, min: 1, max: 5 },
  { tipo: "skive", nombre: "Skive (Kirby)", unidad: "mm", defecto: 2, min: 2, max: 8, sentidos: VARO_VALGO },
  { tipo: "cuna_post", nombre: "Cuña posterior", unidad: "°", defecto: 2, min: 1, max: 6, sentidos: VARO_VALGO },
  { tipo: "alza", nombre: "Alza de talón", unidad: "mm", defecto: 3, min: 1, max: 15 },
  { tipo: "expansion_talon", nombre: "Expansión de talón", unidad: "%", defecto: 10, min: 2, max: 25 },
  { tipo: "espolon", nombre: "Descarga espolón", unidad: "mm", defecto: 2.5, min: 1, max: 5 },
];

export type PiezaMarcada = { valor: number; sentido?: string };
// I = pie izquierdo, D = pie derecho.
export type PiezasMarcadas = { I: Record<string, PiezaMarcada>; D: Record<string, PiezaMarcada> };

// Lee las casillas del formulario de la receta: pz_<tipo>_I / pz_<tipo>_D (marcado), pz_<tipo>_valor y
// pz_<tipo>_sentido. Valores fuera de rango se ajustan al rango; sentidos desconocidos, al de por defecto.
// null si no hay ninguna pieza marcada.
export function piezasDeFormulario(fd: FormData): PiezasMarcadas | null {
  const out: PiezasMarcadas = { I: {}, D: {} };
  for (const p of PIEZAS_RECETA) {
    const pies = (["I", "D"] as const).filter((pie) => fd.get(`pz_${p.tipo}_${pie}`) != null);
    if (!pies.length) continue;
    const n = Number(String(fd.get(`pz_${p.tipo}_valor`) ?? "").replace(",", "."));
    const valor = Number.isFinite(n) && n > 0 ? Math.min(p.max, Math.max(p.min, Math.round(n * 10) / 10)) : p.defecto;
    const marcada: PiezaMarcada = { valor };
    if (p.sentidos) {
      const s = String(fd.get(`pz_${p.tipo}_sentido`) ?? "");
      marcada.sentido = p.sentidos.some(([v]) => v === s) ? s : p.sentidos[0][0];
    }
    for (const pie of pies) out[pie][p.tipo] = { ...marcada };
  }
  return Object.keys(out.I).length || Object.keys(out.D).length ? out : null;
}

// Texto de las piezas marcadas (para el PDF de la receta y la hoja del taller).
export function textoPiezas(piezas: PiezasMarcadas | null | undefined): string {
  if (!piezas) return "";
  const linea = (pie: "I" | "D") => {
    const partes = PIEZAS_RECETA.filter((p) => piezas[pie]?.[p.tipo]).map((p) => {
      const m = piezas[pie][p.tipo];
      const sentido = p.sentidos?.find(([v]) => v === m.sentido)?.[1];
      return `${p.nombre} ${m.valor.toLocaleString("es-ES")}${p.unidad === "mm" ? " mm" : p.unidad}${sentido ? ` (${sentido.toLowerCase()})` : ""}`;
    });
    return partes.length ? `${pie === "I" ? "Pie izquierdo" : "Pie derecho"}: ${partes.join("; ")}.` : "";
  };
  return [linea("I"), linea("D")].filter(Boolean).join("\n");
}
