// Máquinas CNC y su placa en la nube (Ortosend Taller): lo fresado de cada placa se comparte entre
// ordenadores y repetir una operación (reenvío tras estar sin conexión) no duplica nada.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createAppToken, hashPassword } from "@/lib/auth";
import { GET as listar, POST as crear } from "@/app/api/taller/maquinas/route";
import { POST as placaNueva } from "@/app/api/taller/maquinas/[id]/placa/route";
import { POST as tirada } from "@/app/api/taller/maquinas/[id]/tiradas/route";
import { POST as anular } from "@/app/api/taller/maquinas/[id]/tiradas/[tiradaId]/anular/route";

const pet = (token: string | null, body?: unknown) =>
  new Request("http://localhost/api/taller/maquinas", {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const con = (id: string, tiradaId?: string) => ({ params: Promise.resolve({ id, tiradaId: tiradaId ?? "" }) });

let token = "";
let tokenPro = "";

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { role: "TALLER", name: "Rosa Taller", email: "rosa-cnc@ortosend.test", passwordHash: await hashPassword("x1234567") },
  });
  const pro = await prisma.user.create({
    data: { role: "PROFESIONAL", name: "Pro", email: "pro-cnc@ortosend.test", passwordHash: await hashPassword("x1234567") },
  });
  token = await createAppToken(u);
  tokenPro = await createAppToken(pro);
});

describe("máquinas CNC y su placa", () => {
  it("crear máquina, poner placa, registrar y deshacer tiradas; repetir no duplica", async () => {
    expect((await listar(pet(null))).status).toBe(401);
    expect((await listar(pet(tokenPro))).status).toBe(403);
    const r = await crear(pet(token, { nombre: "  CNC   taller " }));
    const { maquina } = await r.json();
    expect(maquina).toMatchObject({ nombre: "CNC taller", placa: null });
    expect((await crear(pet(token, { nombre: "CNC taller" }))).status).toBe(409);

    const placa = { id: "placa-0001-aaaa", ancho: 600, largo: 500, alto: 45 };
    let m = (await (await placaNueva(pet(token, placa), con(maquina.id))).json()).maquina;
    expect(m.placa).toMatchObject({ id: placa.id, ancho: 600, largo: 500, alto: 45, puestaPor: "Rosa Taller", tiradas: [] });

    const t1 = { id: "tirada-0001-aaaa", placaId: placa.id, nombre: "L-01", zonas: [{ x: 0, y: 0, ancho: 150, largo: 300 }] };
    m = (await (await tirada(pet(token, t1), con(maquina.id))).json()).maquina;
    // El mismo envío otra vez (p. ej. reintento tras quedarse sin conexión): no se duplica.
    m = (await (await tirada(pet(token, t1), con(maquina.id))).json()).maquina;
    expect(m.placa.tiradas).toHaveLength(1);
    expect(m.placa.tiradas[0]).toMatchObject({ nombre: "L-01", quien: "Rosa Taller", zonas: t1.zonas });

    const t2 = { ...t1, id: "tirada-0002-aaaa", nombre: "L-02", zonas: [{ x: 160, y: 0, ancho: 150, largo: 300 }] };
    await tirada(pet(token, t2), con(maquina.id));
    m = (await (await anular(pet(token, {}), con(maquina.id, t2.id))).json()).maquina;
    expect(m.placa.tiradas.map((t: { nombre: string }) => t.nombre)).toEqual(["L-01"]);
    expect((await prisma.tiradaPlaca.findUniqueOrThrow({ where: { id: t2.id } })).anuladaPor).toBe("Rosa Taller");

    // Otro ordenador ve lo mismo.
    const { maquinas } = await (await listar(pet(token))).json();
    expect(maquinas.find((x: { id: string }) => x.id === maquina.id).placa.tiradas).toHaveLength(1);

    // Placa nueva: libre otra vez (lo anterior queda en el historial).
    m = (await (await placaNueva(pet(token, { ...placa, id: "placa-0002-aaaa" }), con(maquina.id))).json()).maquina;
    expect(m.placa).toMatchObject({ id: "placa-0002-aaaa", tiradas: [] });
    expect(await prisma.tiradaPlaca.count({ where: { placa: { maquinaId: maquina.id } } })).toBe(2);
  });

  it("rechaza datos malos", async () => {
    const { maquina } = await (await crear(pet(token, { nombre: "CNC 2" }))).json();
    expect((await placaNueva(pet(token, { id: "x", ancho: 600, largo: 500, alto: 45 }), con(maquina.id))).status).toBe(400);
    expect((await placaNueva(pet(token, { id: "placa-0003-aaaa", ancho: -1, largo: 500, alto: 45 }), con(maquina.id))).status).toBe(400);
    await placaNueva(pet(token, { id: "placa-0003-aaaa", ancho: 600, largo: 500, alto: 45 }), con(maquina.id));
    const fuera = { id: "tirada-0009-aaaa", placaId: "placa-0003-aaaa", nombre: "X", zonas: [{ x: 900, y: 0, ancho: 10, largo: 10 }] };
    expect((await tirada(pet(token, fuera), con(maquina.id))).status).toBe(400);
    // Una placa de otra máquina no vale.
    const otra = { ...fuera, placaId: "placa-0001-aaaa", zonas: [{ x: 0, y: 0, ancho: 10, largo: 10 }] };
    expect((await tirada(pet(token, otra), con(maquina.id))).status).toBe(409);
  });
});
