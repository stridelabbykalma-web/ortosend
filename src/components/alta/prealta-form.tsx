"use client";

// Formulario de pre-alta del profesional. Si la fecha de nacimiento indica un
// menor de 16 años, pide los datos del tutor (los mensajes irán a él).
import { useState } from "react";

const EDAD_MAYORIA_SALUD = 16;

function edad(fecha: string) {
  const b = new Date(fecha);
  if (isNaN(+b)) return null;
  const now = new Date();
  let e = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) e--;
  return e;
}

export function PreAltaForm({ action, declaracion }: { action: (f: FormData) => Promise<void>; declaracion: string }) {
  const [nacimiento, setNacimiento] = useState("");
  const e = nacimiento ? edad(nacimiento) : null;
  const menor = e !== null && e < EDAD_MAYORIA_SALUD;
  return (
    <form action={action}>
      <div className="grid g2">
        <div>
          <label htmlFor="pa-nombre">Nombre</label>
          <input id="pa-nombre" name="nombre" required autoComplete="off" />
        </div>
        <div>
          <label htmlFor="pa-apellidos">Apellidos</label>
          <input id="pa-apellidos" name="apellidos" required autoComplete="off" />
        </div>
      </div>
      <div className="grid g2">
        <div>
          <label htmlFor="pa-nacimiento">Fecha de nacimiento</label>
          <input id="pa-nacimiento" name="fechaNacimiento" type="date" required value={nacimiento} onChange={(ev) => setNacimiento(ev.target.value)} />
        </div>
        <div>
          <label htmlFor="pa-telefono">Móvil del paciente{menor ? " (opcional)" : ""}</label>
          <input id="pa-telefono" name="telefono" type="tel" placeholder="+34 600 112 233" required={!menor} autoComplete="off" />
        </div>
      </div>
      <label htmlFor="pa-email">Email (opcional)</label>
      <input id="pa-email" name="email" type="email" autoComplete="off" />
      {menor && (
        <div className="card" style={{ marginTop: 10, background: "var(--paper)" }}>
          <b>Paciente menor de {EDAD_MAYORIA_SALUD} años ({e} años)</b>
          <div className="tiny" style={{ margin: "4px 0 8px" }}>
            Los mensajes de WhatsApp y la aceptación de los documentos van a su padre, madre o tutor legal.
          </div>
          <label htmlFor="pa-tutor">Nombre y apellidos del tutor legal</label>
          <input id="pa-tutor" name="tutorNombre" required />
          <div className="grid g2">
            <div>
              <label htmlFor="pa-tutor-tel">Móvil del tutor (recibirá el WhatsApp)</label>
              <input id="pa-tutor-tel" name="tutorTelefono" type="tel" placeholder="+34 600 112 233" required />
            </div>
            <div>
              <label htmlFor="pa-tutor-email">Email del tutor (opcional)</label>
              <input id="pa-tutor-email" name="tutorEmail" type="email" />
            </div>
          </div>
        </div>
      )}
      <label className="chk" style={{ marginTop: 12 }}>
        <input type="checkbox" name="declaracion" required /> {declaracion}
      </label>
      <div className="sp" />
      <button type="submit" className="pri">
        Dar de alta y enviar WhatsApp
      </button>
    </form>
  );
}
