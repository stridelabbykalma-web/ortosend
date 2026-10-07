// Cada ejecución de los tests usa un esquema de Postgres nuevo con todas las
// migraciones aplicadas (incluidos los triggers append-only), y lo borra al final.
// Base de datos: TEST_DATABASE_URL (por defecto, la local de desarrollo).
import { execSync } from "child_process";
import type { TestProject } from "vitest/node";

const BASE = process.env.TEST_DATABASE_URL ?? "postgresql://ortosend:ortosend@localhost:5432/ortosend_test";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const schema = `t_${Date.now()}`;
  const url = `${BASE}${BASE.includes("?") ? "&" : "?"}schema=${schema}`;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  project.provide("databaseUrl", url);
  return async () => {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url } } });
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  };
}
