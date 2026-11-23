# AI integration contract

The AI service (`ai-service/main.py`) has two endpoints. Only one is called by the API.

| Endpoint | What it does | Called by the API |
| --- | --- | --- |
| `POST /identify` | Check-in face identification: compares the face in a check-in photo with the registered photos of the candidates assigned to the exam | Yes, from `POST /api/student/organizations/:organizationId/exams/:examId/identity-check` in `server/src/app.ts` |
| `POST /analyze` | Single-frame face count and optional phone detection | No. Browser signals (tab and fullscreen) are the only proctoring events today |

## Check-in identification (`/identify`)

Decided on 2 November 2026 by the provider, Nekod Test Labs B.V., for the ExamGuard check-in feature.

1. The API authenticates to the AI service with `AI_SERVICE_TOKEN` as a bearer credential. The service rejects a missing or wrong credential with 401.
2. The API checks the candidate, the organization, the exam assignment, that the exam requires verification, and that the candidate's registered photo was approved, before it sends anything.
3. The API sends the check-in photo and the registered photos of the candidates assigned to the same exam. Each registered photo is named by its candidate ID. Nothing else about the candidates is sent.
4. The service finds the face with OpenCV YuNet, computes an SFace feature, and returns the face count, the most similar registered photo, its cosine similarity, the threshold (0.363 by default) and the model version. It stores nothing.
5. The API validates the response (`server/src/ai-identity.ts`) and stores it as an `IdentityMatch` with status `pending_verification`. A malformed answer, a timeout (15 seconds) or a reference the API did not send is a service failure, and no match is stored.
6. **Two-person verification.** An identification is never acted on by itself. The candidate is admitted to the exam (`admit`) or an identity incident is opened (`mismatch`, `no_match`) only after two different, authorized verifiers have each confirmed the match. The rules are in `server/src/identity-verification.ts` and the procedure is `docs/compliance/identity-verification-procedure.md`.
7. There is no automatic action on a high similarity score, no administrator override and no other route that changes an `IdentityMatch`.
8. The check-in photo is stored privately under `organizations/<org>/candidates/<candidate>/identity-checks/`. Feature vectors are not stored.

## Frame analysis (`/analyze`)

Not integrated. Before the API may call it:

1. The API must authenticate the candidate, verify candidate, organization and attempt ownership, require `in_progress` status and enforce the server deadline before forwarding a frame.
2. Explicit, revocable candidate consent for camera capture must be stored at the exam-session level before any call.
3. Frames are processed in memory only. Maximum frame size is 5 MB at the API and 10 MB at the service.
4. A validated response may create only a review-only proctoring event. It must never change attempt state, create a misconduct conclusion or change grading.
