// Contrato común de los programas de agenda que se pueden conectar a Ortosend.
// Cada programa es un «proveedor» con un adaptador propio (proveedor-*.ts);
// la orquestación (index.ts) no sabe de ninguno en concreto.
//
// Hay dos tipos:
// - «api»: el programa tiene API y la clínica da una clave. Se elige la cuenta
//   o clínica dentro del programa, se enlaza cada agenda de Ortosend con la de
//   su profesional allí y, si el programa lo permite, Ortosend comprueba el
//   hueco en tiempo real y apunta allí sus citas.
// - «ical»: solo lectura. Cada agenda de Ortosend recibe el enlace iCal privado
//   del calendario del profesional (Google, Outlook, Apple o el programa de la
//   clínica que lo exporte) y se resta lo que tenga ocupado.
import type { ConnectorLink } from "@prisma/client";
import type { LocalDate } from "../agenda";
import type { Tramo } from "./ocupacion";

export type Cuenta = { id: string; name: string };
export type AgendaExterna = { id: string; staffId: string; placeId: string; nombre: string };
export type Servicio = { id: string; name: string; active: boolean; minutes: number };

export type Enlace = ConnectorLink & { secreto: string | null };

export type CtxLectura = {
  clave: string | null;
  cuenta: string | null;
  enlaces: Enlace[];
  tz: string;
  desde: LocalDate;
  hasta: LocalDate; // inclusive
  ownIds: Set<string>; // ids en el programa de citas que son copia de citas de Ortosend
  respectHours: boolean;
};

export type PacienteParaPrograma = {
  nombre: string;
  apellidos: string;
  telefono: string | null; // nacional normalizado (600112233) o internacional (+…)
  email: string | null;
  fichaConocida: string | null; // id de su ficha en el programa, si ya se guardó
};

export type CitaParaPrograma = {
  enlace: Enlace;
  servicioId: string | null;
  desde: Date;
  hasta: Date;
  timezone: string;
  nota: string; // sin contenido clínico
  paciente: PacienteParaPrograma;
  forzar: boolean;
};

export type EstadoExterno = "cancelada" | "no_presentado";

type Comun = {
  kind: string;
  nombre: string; // como lo ve la clínica
  corto: string; // para frases cortas: «Ocupado en …», «Apuntada en …»
  ayuda: string; // dónde se consigue el acceso
  // enlacesFallidos: ids de enlaces que no se pudieron leer (se conserva su ocupación anterior)
  leer(ctx: CtxLectura): Promise<{ tramos: Tramo[]; avisos: string[]; enlacesFallidos?: string[] }>;
  explicarError(e: unknown): string;
};

export type ProveedorApi = Comun & {
  modo: "api";
  formatoClave?: RegExp;
  cuentas(clave: string): Promise<Cuenta[]>; // también valida la clave
  agendas(clave: string, cuenta: string): Promise<AgendaExterna[]>;
  servicios?(clave: string, cuenta: string): Promise<Servicio[]>;
  // true libre · false ocupado · lanza si no se pudo comprobar
  comprobar?(clave: string, cuenta: string, enlace: Enlace, desde: Date, hasta: Date, ownIds: Set<string>, respectHours: boolean): Promise<boolean>;
  apuntar?(clave: string, cuenta: string, cita: CitaParaPrograma): Promise<{ id: string; fichaId: string | null }>;
  cambiarEstado?(clave: string, cuenta: string, externalId: string, estado: EstadoExterno): Promise<void>;
  // El servicio guardado ya no vale (para volver a buscarlo por nombre)
  esErrorDeServicio?(e: unknown): boolean;
};

export type ProveedorIcal = Comun & {
  modo: "ical";
};

export type Proveedor = ProveedorApi | ProveedorIcal;
