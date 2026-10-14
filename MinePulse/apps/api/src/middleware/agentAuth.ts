import type { NextFunction, Request, Response } from 'express';
import { agentCredentialRepository } from '../repositories/agentCredentialRepository.js';
import {
  agentTokenPrefix,
  hashAgentToken,
  timingSafeEqualHex,
} from '../security/agentToken.js';
import { AppError } from '../utils/errors.js';

/**
 * Authenticate a MinePulseAgent request via the `x-agent-token` header.
 * Agent auth is completely separate from browser session auth: an agent token
 * can only reach /agent/* routes, and a browser session can never authorize one.
 */
export async function agentAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.header('x-agent-token');
    if (!token || token.length > 512) return next(AppError.unauthorized('Missing agent token'));

    const prefix = agentTokenPrefix(token);
    const candidates = await agentCredentialRepository.findByPrefix(prefix);
    const hash = hashAgentToken(token);
    const match = candidates.find((c) => timingSafeEqualHex(c.tokenHash, hash));

    if (!match) return next(AppError.unauthorized('Invalid agent token'));

    req.agent = { credentialId: match.id, serverId: match.serverId };
    void agentCredentialRepository.touchLastUsed(match.id);
    next();
  } catch (error) {
    next(error);
  }
}
