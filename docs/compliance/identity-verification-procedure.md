# ExamGuard check-in identity verification procedure

Version 1.0, in force from 2 November 2026. Owner: the Exam Integrity Lead at Nekod Test Labs B.V., Keizersgracht 100, 1015 CW Amsterdam, the Netherlands (compliance@nekod-testlabs.example). Next review: 2 November 2027.

## What this covers

When an exam requires verification, a candidate takes a check-in photo before starting. The AI service (`POST /identify`, OpenCV YuNet and SFace) compares it with the approved registered photos of every candidate assigned to that exam and names the closest match. That match is an identification. ExamGuard takes no action and no decision about the candidate on the basis of it until two people have each verified and confirmed it.

| System proposal | What happens after two confirmations | What happens before |
| --- | --- | --- |
| `admit`: the closest match is the candidate, above the threshold | The candidate can start the exam | The exam cannot start (`server/src/app.ts`, start route, `identityAdmitsCandidate`) |
| `mismatch`: the closest match is another candidate | A high-severity `identity_mismatch` incident is opened for review | Nothing: no incident, no message to the candidate about the result |
| `no_match`: no registered photo reaches the threshold | A high-severity `identity_not_matched` incident is opened | Nothing |

If either verifier rejects the proposal, the match is `disputed`. It is discarded and the candidate takes a new check-in photo. Nothing else happens to the candidate.

## Who may verify

Verification is limited to people who meet all four conditions. The API checks each one on every verification (`verifierMayVerify` in `server/src/identity-verification.ts`).

1. **Role.** An active membership of the institute as `proctor` or `institute_admin`. Teachers and students cannot verify.
2. **Training.** Completed training module EG-IDV-1 (below), with the completion date recorded in ExamGuard.
3. **Authority.** Authorized by an institute administrator other than themselves, on the Identity checks screen. The authorization lasts 12 months from the training date and can be revoked at any time.
4. **Independence.** Not the candidate whose photo is being checked, and not the person who recorded the first verification of the same match.

## Training module EG-IDV-1

Delivered by the institute's Exam Integrity Lead, using material from Nekod Test Labs B.V. About three hours.

1. How the check-in identification works: what YuNet and SFace do, what the similarity score and the 0.363 threshold mean, and that a score is not proof of identity.
2. Known limits: poor light, motion blur, glasses, head coverings, ageing since the registered photo, and lower accuracy reported for some groups in face recognition research. When in doubt, reject.
3. How to compare faces: compare stable features (face shape, ears, eyes, nose, scars) and not hair, make-up or clothing.
4. The procedure below, including why the two verifications must be independent.
5. Data protection: the photos are special category personal data under GDPR Article 9. View them only on the Identity checks screen, never copy or share them.
6. Assessment: 20 photo pairs, including 5 look-alike pairs. Pass mark 18 out of 20. A person who does not pass repeats the module.

A refresher with a new assessment is due every 12 months; the authorization in ExamGuard expires at the same time.

## Procedure for each match

1. Open **Identity checks**. Pending matches are shown oldest first.
2. Compare the check-in photo with the registered photo (and, for `mismatch`, with the matched candidate's photo).
3. Decide on your own. Do not discuss the match with the other verifier until both decisions are recorded. The screen and the API never show another verifier's decision or reason while a match is pending.
4. Choose **Confirm** or **Reject** and write what you compared and why. Both decision and reason are stored (`identity_verifications`) and written to the audit log.
5. A second verifier, a different person, does the same. The match takes effect only when both have confirmed it.

## Records

- `identity_verifiers`: who is authorized, the training module and date, who authorized them, expiry and revocation.
- `identity_verifications`: each verifier's decision and reason, one per person per match (unique index).
- `identity_matches`: the system's proposal, score, threshold, model version and final status.
- `audit_logs`: every authorization, revocation, verification and settled match.
- EG-IDV-1 assessment results are kept by the institute's Exam Integrity Lead for 3 years.
