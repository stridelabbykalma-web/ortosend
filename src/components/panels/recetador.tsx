import type { User } from "@prisma/client";
import { MesaRevisor } from "@/components/revisor/mesa";

// Recetador central de Ortosend: cola de las clínicas sin prescriptor propio.
export function PanelRecetador({ user }: { user: User }) {
  return <MesaRevisor user={user} modo="central" />;
}
