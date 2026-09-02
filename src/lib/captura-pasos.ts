// Pasos del modo captura guiado (cámara con silueta y comprobación automática).
// Compartido entre el wizard (enlaces/checklist), la página del caso y las rutas API.

export type Orientacion = "frontal" | "posterior" | "lateral";

export type PasoCaptura = {
  paso: number; // 1-based, es el ?paso= de la URL
  kind: string; // kind del MediaAsset
  modo: "foto" | "video";
  titulo: string;
  descripcion: string; // qué se valora clínicamente
  caption: string; // instrucción corta bajo la cámara
  orientacion: Orientacion;
  duracionS?: number; // solo vídeo
};

// Estáticas de bipedestación (2 fotos) + protocolo de vídeos (6 de marcha + heel rise).
export const PASOS_CAPTURA: PasoCaptura[] = [
  {
    paso: 1,
    kind: "foto_de_pie_ant",
    modo: "foto",
    titulo: "De pie — vista anterior",
    descripcion:
      "Bipedestación de frente: se valora el alineamiento de rodillas, rótulas y antepié, y la simetría en estático.",
    caption: "de pie, quieto, de frente a la cámara",
    orientacion: "frontal",
  },
  {
    paso: 2,
    kind: "foto_de_pie_post",
    modo: "foto",
    titulo: "De pie — vista posterior",
    descripcion:
      "Bipedestación de espaldas: se valora la posición del calcáneo (varo/valgo de retropié), el tendón de Aquiles y la simetría de talones.",
    caption: "de pie, quieto, de espaldas a la cámara",
    orientacion: "posterior",
  },
  {
    paso: 3,
    kind: "video_lat_dcha_descalzo",
    modo: "video",
    titulo: "Marcha lateral derecha — descalzo",
    descripcion:
      "Marcha de perfil (lado derecho hacia la cámara), descalzo: se valora el choque de talón, el despegue y el rango sagital de tobillo y rodilla.",
    caption: "camina en línea recta, con el lado derecho hacia la cámara",
    orientacion: "lateral",
    duracionS: 8,
  },
  {
    paso: 4,
    kind: "video_lat_dcha_calzado",
    modo: "video",
    titulo: "Marcha lateral derecha — calzado",
    descripcion:
      "Igual que la anterior pero con el calzado habitual: se compara el patrón de apoyo con y sin zapato.",
    caption: "con tu calzado habitual, lado derecho hacia la cámara",
    orientacion: "lateral",
    duracionS: 8,
  },
  {
    paso: 5,
    kind: "video_lat_izq_descalzo",
    modo: "video",
    titulo: "Marcha lateral izquierda — descalzo",
    descripcion:
      "Marcha de perfil (lado izquierdo hacia la cámara), descalzo: se valora la simetría respecto al lado derecho.",
    caption: "camina en línea recta, con el lado izquierdo hacia la cámara",
    orientacion: "lateral",
    duracionS: 8,
  },
  {
    paso: 6,
    kind: "video_lat_izq_calzado",
    modo: "video",
    titulo: "Marcha lateral izquierda — calzado",
    descripcion:
      "Igual que la anterior pero con el calzado habitual, lado izquierdo hacia la cámara.",
    caption: "con tu calzado habitual, lado izquierdo hacia la cámara",
    orientacion: "lateral",
    duracionS: 8,
  },
  {
    paso: 7,
    kind: "video_post_descalzo",
    modo: "video",
    titulo: "Marcha posterior — descalzo",
    descripcion:
      "Marcha alejándose de la cámara, descalzo: se valora la eversión del retropié y el desgaste del patrón de apoyo.",
    caption: "camina alejándote de la cámara, en línea recta",
    orientacion: "posterior",
    duracionS: 8,
  },
  {
    paso: 8,
    kind: "video_post_calzado",
    modo: "video",
    titulo: "Marcha posterior — calzado",
    descripcion:
      "Igual que la anterior pero con el calzado habitual: se observa la deformación del contrafuerte.",
    caption: "con tu calzado habitual, alejándote de la cámara",
    orientacion: "posterior",
    duracionS: 8,
  },
  {
    paso: 9,
    kind: "video_heel_rise",
    modo: "video",
    titulo: "Heel rise test — descalzo",
    descripcion:
      "Elevaciones de talón de espaldas a la cámara: se valora la función del tibial posterior y la inversión del calcáneo al subir.",
    caption: "de espaldas a la cámara, sube y baja de puntillas",
    orientacion: "posterior",
    duracionS: 12,
  },
];

export const FOTO_KINDS = PASOS_CAPTURA.filter((p) => p.modo === "foto").map((p) => p.kind);
export const CAPTURA_KINDS = PASOS_CAPTURA.map((p) => p.kind);

export function pasoByNumber(n: number) {
  return PASOS_CAPTURA.find((p) => p.paso === n) ?? null;
}

// Primer paso aún sin confirmar (para "continuar donde lo dejaste").
export function primerPasoPendiente(confirmedKinds: string[]) {
  return PASOS_CAPTURA.find((p) => !confirmedKinds.includes(p.kind)) ?? null;
}
