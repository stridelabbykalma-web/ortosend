import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Flash } from "@/components/ui";
import { PanelCliente } from "@/components/panels/cliente";
import { PanelClinica } from "@/components/panels/clinica";
import { PanelRecetador } from "@/components/panels/recetador";
import { PanelTaller } from "@/components/panels/taller";
import { PanelAdmin } from "@/components/panels/admin";

export const dynamic = "force-dynamic";

export default async function PanelPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ok?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { tab, ok, error } = await searchParams;
  return (
    <div className="wrap">
      <div className="sp2" />
      <Flash ok={ok} error={error} />
      {user.role === "CLIENTE" && <PanelCliente user={user} />}
      {(user.role === "PROFESIONAL" || user.role === "ADMIN_CLINICA") && (
        <PanelClinica user={user} tab={tab} />
      )}
      {user.role === "RECETADOR" && <PanelRecetador user={user} />}
      {user.role === "TALLER" && <PanelTaller user={user} />}
      {user.role === "ADMIN" && <PanelAdmin tab={tab} />}
    </div>
  );
}
