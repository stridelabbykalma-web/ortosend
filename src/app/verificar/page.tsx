import Link from "next/link";
import { prisma } from "@/lib/db";
import { verifyEmailToken } from "@/lib/auth";
import { VERIFY_DAYS } from "@/lib/cuenta";

export const dynamic = "force-dynamic";

// Confirmación del email desde el enlace del correo de bienvenida.
export default async function VerificarPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const data = await verifyEmailToken(token);
  const user = data ? await prisma.user.findUnique({ where: { id: data.uid } }) : null;
  let estado: "ok" | "ya" | "otro" | "invalido";
  if (!user || !data) estado = "invalido";
  else if (user.email !== data.email) estado = "otro"; // cambió el email después de enviar el enlace
  else if (user.emailVerifiedAt) estado = "ya";
  else {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    estado = "ok";
  }
  return (
    <div className="wrap" style={{ maxWidth: 480 }}>
      <div className="sp2" />
      <h2>Confirmación de email</h2>
      <div className="sp" />
      {estado === "ok" && <div className="note g">Email confirmado. Ya puedes recuperar tu contraseña con él si la olvidas.</div>}
      {estado === "ya" && <div className="note g">Este email ya estaba confirmado.</div>}
      {estado === "otro" && (
        <div className="note a">
          Este enlace corresponde a un email que ya has cambiado. Pide uno nuevo desde tu panel.
        </div>
      )}
      {estado === "invalido" && (
        <div className="note r">
          El enlace no es válido o ha caducado (validez: {VERIFY_DAYS} días). Puedes pedir otro desde tu panel.
        </div>
      )}
      <div className="sp" />
      <Link href="/panel" className="btn pri">
        Ir a mi panel
      </Link>
    </div>
  );
}
