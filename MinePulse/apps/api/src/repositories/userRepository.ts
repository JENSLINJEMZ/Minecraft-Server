import { prisma } from '../lib/prisma.js';
import type { User } from '@prisma/client';

export const userRepository = {
  count(): Promise<number> {
    return prisma.user.count();
  },

  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  },

  create(input: { email: string; passwordHash: string; role: string }): Promise<User> {
    return prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
      },
    });
  },
};
