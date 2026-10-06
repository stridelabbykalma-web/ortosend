"use client";

// Lista de altas de la clínica con el estado en vivo (consulta cada 3 s, sin
// recargar). Solo estados y progreso: ningún dato de salud.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { EstadoPanel } from "@/lib/alta";
import { ESTADO_PACIENTE } from "@/lib/consent/estados";


const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export function PacientesEnVivo({ inicial }: { inicial: EstadoPanel[] }) {
  const [pacientes, setPacientes] = useState(inicial);
  const [desconectado, setDesconectado] = useState(false);

  useEffect(() => {
    let vivo = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/pacientes/estado", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { pacientes: EstadoPanel[] };
        if (vivo) {
          setPacientes(json.pacientes);
          setDesconectado(false);
        }
      } catch {
        if (vivo) setDesconectado(true);
      }
    };
    const id = setInterval(tick, 3000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  if (!pacientes.length) return <div className="muted">Aún no has dado de alta a ningún paciente con este sistema.</div>;
  return (
    <>
      {desconectado && <div className="tiny" style={{ color: "var(--red, #b42318)" }}>Sin conexión: reintentando…</div>}
      <table>
        <thead>
          <tr>
            <th>Paciente</th>
            <th>Estado</th>
            <th>Documentos</th>
            <th>WhatsApp</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pacientes.map((p) => {
            const e = ESTADO_PACIENTE[p.status];
            return (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>
                  <span className={`pill ${e.color}`}>{e.texto}</span>
                  {p.status === "ACEPTADO" && (
                    <div className="tiny">{p.cuenta ? "Con cuenta" : p.accesoEnviado ? "Acceso enviado" : "Completa la ficha y envía el acceso"}</div>
                  )}
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  {p.aceptados}/{p.total}
                </td>
                <td className="tiny">
                  {p.envio === "ERROR" ? "No enviado" : `Enviado ${hora(p.enviadoAt)}`}
                  {p.status === "PENDIENTE" && p.expiraAt && <div>Caduca {hora(p.expiraAt)}</div>}
                </td>
                <td>
                  <Link href={`/panel/paciente/${p.id}`} className="btn">
                    {p.status === "ACEPTADO" ? "Abrir ficha" : "Ver"}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
