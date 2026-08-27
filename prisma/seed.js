// Seed de desarrollo: clínicas, cuentas de todos los roles y dos casos demo.
// Ejecutar con: npx prisma db seed
const { PrismaClient } = require("@prisma/client");
const { seedDemo } = require("./seed-data");

const prisma = new PrismaClient();

seedDemo(prisma)
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
