import { z } from 'zod';

// Client for the AI service's POST /identify endpoint. The service finds the
// face in the check-in photo and compares it with each registered photo it is
// sent. Its answer is a proposal for two human verifiers (see
// identity-verification.ts), never a decision.

export type GalleryPhoto = { candidateId: string; image: Buffer; contentType: string };
export type Identification = { faceCount: number; best: { candidateId: string; similarity: number } | null; threshold: number; modelVersion: string };

const response = z.object({
  face_count: z.number().int().min(0),
  best_match: z.object({ reference_id: z.string().uuid(), similarity: z.number().min(-1).max(1) }).nullable(),
  threshold: z.number().min(0).max(1),
  model_version: z.string().min(1)
});

export class AiServiceUnavailable extends Error {}

export async function identifyFace(probe: { image: Buffer; contentType: string }, gallery: GalleryPhoto[], env = process.env): Promise<Identification> {
  const baseUrl = env.AI_SERVICE_URL;
  const token = env.AI_SERVICE_TOKEN;
  if (!baseUrl || !token) throw new AiServiceUnavailable('The AI service is not configured');
  const form = new FormData();
  form.append('probe', new Blob([new Uint8Array(probe.image)], { type: probe.contentType }), 'check-in.jpg');
  for (const photo of gallery) form.append('references', new Blob([new Uint8Array(photo.image)], { type: photo.contentType }), photo.candidateId);
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, '')}/identify`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AiServiceUnavailable('The AI service could not be reached');
  }
  if (!res.ok) throw new AiServiceUnavailable(`The AI service answered ${res.status}`);
  const parsed = response.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new AiServiceUnavailable('The AI service returned a malformed identification');
  const { face_count, best_match, threshold, model_version } = parsed.data;
  if (best_match && !gallery.some(photo => photo.candidateId === best_match.reference_id)) throw new AiServiceUnavailable('The AI service named a reference that was not sent');
  return { faceCount: face_count, best: best_match ? { candidateId: best_match.reference_id, similarity: best_match.similarity } : null, threshold, modelVersion: model_version };
}
