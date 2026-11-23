import test from 'node:test';
import assert from 'node:assert/strict';
import { identityAdmitsCandidate, proposedOutcomeFor, settleIdentityMatch, verifierAuthorizationExpiry, verifierMayVerify } from '../src/identity-verification.js';

const now = new Date('2026-11-23T09:00:00Z');
const trained = { trainingModule: 'EG-IDV-1', trainingCompletedAt: new Date('2026-09-01T00:00:00Z'), expiresAt: new Date('2027-09-01T00:00:00Z'), revokedAt: null };
const base = { verifierId: 'proctor-b', role: 'proctor', candidateUserId: 'student-a', matchStatus: 'pending_verification' as const, alreadyVerifiedBy: [] as string[], authorization: trained, now };

test('the AI best match is only a proposal: admit, mismatch or no match', () => {
  assert.deepEqual(proposedOutcomeFor('cand-a', { candidateId: 'cand-a', similarity: 0.7 }, 0.363), { outcome: 'admit', matchedCandidateId: 'cand-a' });
  assert.deepEqual(proposedOutcomeFor('cand-a', { candidateId: 'cand-b', similarity: 0.7 }, 0.363), { outcome: 'mismatch', matchedCandidateId: 'cand-b' });
  assert.deepEqual(proposedOutcomeFor('cand-a', { candidateId: 'cand-a', similarity: 0.2 }, 0.363), { outcome: 'no_match', matchedCandidateId: null });
});

test('one confirmation, however high the similarity, leaves the match pending', () => {
  assert.equal(settleIdentityMatch([{ verifierId: 'proctor-a', decision: 'confirm' }]), 'pending_verification');
});

test('two confirmations from the same account count once', () => {
  assert.equal(settleIdentityMatch([{ verifierId: 'proctor-a', decision: 'confirm' }, { verifierId: 'proctor-a', decision: 'confirm' }]), 'pending_verification');
});

test('two different people must both confirm; one rejection disputes the match', () => {
  assert.equal(settleIdentityMatch([{ verifierId: 'proctor-a', decision: 'confirm' }, { verifierId: 'proctor-b', decision: 'confirm' }]), 'confirmed');
  assert.equal(settleIdentityMatch([{ verifierId: 'proctor-a', decision: 'confirm' }, { verifierId: 'proctor-b', decision: 'reject' }]), 'disputed');
});

test('only a confirmed admit proposal lets a candidate start', () => {
  assert.equal(identityAdmitsCandidate(null), false);
  assert.equal(identityAdmitsCandidate({ status: 'pending_verification', proposedOutcome: 'admit' }), false);
  assert.equal(identityAdmitsCandidate({ status: 'disputed', proposedOutcome: 'admit' }), false);
  assert.equal(identityAdmitsCandidate({ status: 'confirmed', proposedOutcome: 'mismatch' }), false);
  assert.equal(identityAdmitsCandidate({ status: 'confirmed', proposedOutcome: 'admit' }), true);
});

test('a verifier must hold a role, current EG-IDV-1 training and authorization', () => {
  assert.deepEqual(verifierMayVerify(base), { allowed: true });
  assert.equal(verifierMayVerify({ ...base, role: 'teacher' }).allowed, false);
  assert.equal(verifierMayVerify({ ...base, authorization: null }).allowed, false);
  assert.equal(verifierMayVerify({ ...base, authorization: { ...trained, revokedAt: now } }).allowed, false);
  assert.equal(verifierMayVerify({ ...base, authorization: { ...trained, expiresAt: now } }).allowed, false);
  assert.equal(verifierMayVerify({ ...base, authorization: { ...trained, trainingModule: 'general-onboarding' } }).allowed, false);
});

test('a verifier cannot verify twice, verify their own check-in, or verify a settled match', () => {
  assert.equal(verifierMayVerify({ ...base, alreadyVerifiedBy: ['proctor-b'] }).allowed, false);
  assert.equal(verifierMayVerify({ ...base, verifierId: 'student-a' }).allowed, false);
  assert.equal(verifierMayVerify({ ...base, matchStatus: 'confirmed' }).allowed, false);
});

test('authorization lasts twelve months from training', () => {
  assert.equal(verifierAuthorizationExpiry(new Date('2026-03-15T00:00:00Z')).toISOString(), '2027-03-15T00:00:00.000Z');
});
