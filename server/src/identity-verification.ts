// Two-person verification of face identifications made at exam check-in.
//
// The AI service compares a candidate's check-in photo with the registered
// photos of every candidate assigned to the exam and names the best match.
// That identification is only a proposal. Nothing happens to the candidate
// (admission to the exam, or an identity incident) until two different,
// trained and authorized verifiers have each recorded their own decision and
// both confirmed it. The rules for that live here, so that the routes in
// app.ts and the tests share one definition.

export const REQUIRED_VERIFICATIONS = 2;
export const VERIFIER_TRAINING_MODULE = 'EG-IDV-1';
export const VERIFIER_AUTHORIZATION_MONTHS = 12;
export const VERIFIER_ROLES = ['institute_admin', 'proctor'] as const;

export type ProposedOutcome = 'admit' | 'mismatch' | 'no_match';
export type VerificationDecision = 'confirm' | 'reject';
export type MatchStatus = 'pending_verification' | 'confirmed' | 'disputed';

export type BestMatch = { candidateId: string; similarity: number } | null;

/** What the system proposes from the AI service's best match. It is never applied on its own. */
export function proposedOutcomeFor(claimedCandidateId: string, best: BestMatch, threshold: number): { outcome: ProposedOutcome; matchedCandidateId: string | null } {
  if (!best || best.similarity < threshold) return { outcome: 'no_match', matchedCandidateId: null };
  if (best.candidateId === claimedCandidateId) return { outcome: 'admit', matchedCandidateId: best.candidateId };
  return { outcome: 'mismatch', matchedCandidateId: best.candidateId };
}

/**
 * The status of an identification after its verifications. One decision is
 * counted per user account, so a second decision by the same person never
 * counts as the second verification. It is confirmed only when two different
 * people both confirmed it, and disputed when two people decided and at least
 * one rejected it. Fewer than two people means it stays pending.
 */
export function settleIdentityMatch(verifications: Array<{ verifierId: string; decision: VerificationDecision }>): MatchStatus {
  const byVerifier = new Map<string, VerificationDecision>();
  for (const verification of verifications) {
    if (!byVerifier.has(verification.verifierId)) byVerifier.set(verification.verifierId, verification.decision);
  }
  if (byVerifier.size < REQUIRED_VERIFICATIONS) return 'pending_verification';
  return [...byVerifier.values()].every(decision => decision === 'confirm') ? 'confirmed' : 'disputed';
}

export type VerifierAuthorization = { trainingModule: string; trainingCompletedAt: Date; expiresAt: Date; revokedAt: Date | null };

/** Whether this person may record a verification on this identification. */
export function verifierMayVerify(input: {
  verifierId: string;
  role: string | undefined;
  candidateUserId: string | null;
  matchStatus: MatchStatus;
  alreadyVerifiedBy: string[];
  authorization: VerifierAuthorization | null;
  now: Date;
}): { allowed: true } | { allowed: false; reason: string } {
  if (!input.role || !(VERIFIER_ROLES as readonly string[]).includes(input.role)) return { allowed: false, reason: 'Only proctors and institute administrators can verify identity matches.' };
  const auth = input.authorization;
  if (!auth || auth.revokedAt) return { allowed: false, reason: 'You are not an authorized identity verifier for this institute. Ask an institute administrator to record your EG-IDV-1 training and authorize you.' };
  if (auth.trainingModule !== VERIFIER_TRAINING_MODULE) return { allowed: false, reason: 'Your recorded training is not the EG-IDV-1 identity verification module.' };
  if (auth.expiresAt <= input.now) return { allowed: false, reason: 'Your identity verifier authorization has expired. Complete the EG-IDV-1 refresher and ask an administrator to renew it.' };
  if (input.matchStatus !== 'pending_verification') return { allowed: false, reason: 'This identity match already has its two verifications.' };
  if (input.candidateUserId && input.candidateUserId === input.verifierId) return { allowed: false, reason: 'You cannot verify your own identity check.' };
  if (input.alreadyVerifiedBy.includes(input.verifierId)) return { allowed: false, reason: 'You have already verified this identity match. A second verifier must be a different person.' };
  return { allowed: true };
}

/** The only condition under which a check-in identification admits a candidate to an exam. */
export const identityAdmitsCandidate = (match: { status: MatchStatus; proposedOutcome: ProposedOutcome } | null) =>
  Boolean(match && match.status === 'confirmed' && match.proposedOutcome === 'admit');

/** Authorization runs for twelve months from the training date, then the refresher is due. */
export function verifierAuthorizationExpiry(trainingCompletedAt: Date): Date {
  const expiry = new Date(trainingCompletedAt);
  expiry.setUTCMonth(expiry.getUTCMonth() + VERIFIER_AUTHORIZATION_MONTHS);
  return expiry;
}
