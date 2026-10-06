import { inject } from "vitest";

process.env.DATABASE_URL = inject("databaseUrl");
process.env.AUTH_SECRET = "test-secret";
process.env.MANYCHAT_WEBHOOK_SECRET = "webhook-secret";
process.env.MANYCHAT_FLOW_INVITACION = "flow_invitacion";
process.env.MANYCHAT_FLOW_RECORDATORIO = "flow_recordatorio";
process.env.MANYCHAT_FLOW_ACCESO = "flow_acceso";
process.env.MANYCHAT_FLOW_CODIGO = "flow_codigo";
