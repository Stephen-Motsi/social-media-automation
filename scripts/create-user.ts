// Usage: npm run user:create -- <email> <password> [name] [--admin]
// There is no public sign-up; this is how new users get access.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const isAdmin = args.includes("--admin");
  const [email, password, name] = args.filter((a) => a !== "--admin");

  if (!email || !password) {
    console.error("Usage: npm run user:create -- <email> <password> [name] [--admin]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name,
      passwordHash: await bcrypt.hash(password, 12),
      role: isAdmin ? "ADMIN" : "MEMBER",
    },
  });
  console.log(`Created ${user.role} user ${user.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
