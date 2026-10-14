import type { User } from '@prisma/client';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      user?: User;
      session?: { id: string; csrfToken: string };
      agent?: { credentialId: string; serverId: string };
    }
  }
}

export {};
