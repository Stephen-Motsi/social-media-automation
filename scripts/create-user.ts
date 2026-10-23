// Usage: npm run user:create -- <email> <password> [name] [--admin | --super]
// Creates a password account. Staff have no public sign-up; users normally sign in with Google/Facebook.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const role = args.includes("--super") ? "SUPER_ADMIN" : args.includes("--admin") ? "ADMIN" : "USER";
  const [email, password, name] = args.filter((a) => !a.startsWith("--"));

  if (!email || !password) {
    console.error("Usage: npm run user:create -- <email> <password> [name] [--admin | --super]");
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
      role,
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
