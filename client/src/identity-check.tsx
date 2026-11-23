import { useEffect, useState } from "react";
import axios, { type AxiosInstance } from "axios";
import { useQuery } from "@tanstack/react-query";
import { ScanFace, ShieldCheck } from "lucide-react";

type Session = { organization: { id: string }; role: string };
const errorText = (e: unknown, fallback: string) => (axios.isAxiosError(e) ? e.response?.data?.error ?? fallback : fallback);

// Candidate side: take the check-in photo from the camera opened in the
// readiness check, send it, and wait until two proctors have confirmed it.
export function IdentityCheckIn({ api, session, examId, onConfirmed }: { api: AxiosInstance; session: Session; examId: string; onConfirmed: () => void }) {
  const base = `/api/student/organizations/${session.organization.id}/exams/${examId}/identity-check`;
  const [state, setState] = useState<{ code: string; message: string; canStart?: boolean }>({ code: "loading", message: "Checking your identity check status." });
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const refresh = () => api.get(base).then(({ data }) => setState(data)).catch((e) => setError(errorText(e, "We could not load your identity check. Reload the page to try again.")));
  useEffect(() => { void refresh(); }, [base]);
  useEffect(() => {
    if (state.code !== "identity_check_pending") return;
    const id = setInterval(() => void refresh(), 15000);
    return () => clearInterval(id);
  }, [state.code]);
  const capture = async () => {
    setError("");
    const stream = (window as any).__examguardCameraStream as MediaStream | undefined;
    if (!stream?.active) return setError("Your camera is off. Go back to the readiness check and turn it on.");
    setSending(true);
    try {
      const video = document.createElement("video");
      video.srcObject = stream; video.muted = true; video.playsInline = true;
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      video.pause(); video.srcObject = null;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("capture failed");
      const form = new FormData(); form.append("file", blob, "check-in.jpg");
      const { data } = await api.post(base, form);
      setState(data);
    } catch (e) {
      setError(errorText(e, "We could not send your photo. Try again."));
    } finally { setSending(false); }
  };
  return <div className="card max-w-2xl">
    <p className="eyebrow">Identity check-in</p>
    <h2 className="mt-1 text-xl font-semibold">Confirm it is you</h2>
    <p className="mt-2 text-sm leading-6 text-slate-500">We compare one photo from your camera with your registered photo. Two proctors check the result before you can start. The photo is stored privately for your institute's review.</p>
    <p role="status" className="mt-5 rounded-xl bg-slate-50 p-4 text-sm">{state.message}</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
    <div className="mt-6 flex flex-wrap gap-3">
      {state.code === "identity_check_required" && <button type="button" onClick={capture} disabled={sending} className="button disabled:opacity-50"><ScanFace size={16} className="mr-2 inline" />{sending ? "Sending photo" : "Take check-in photo"}</button>}
      {state.code === "identity_check_pending" && <button type="button" onClick={() => void refresh()} className="button-secondary">Check again</button>}
      {state.canStart && <button type="button" onClick={onConfirmed} className="button">Start secure exam</button>}
    </div>
  </div>;
}

// Staff side: the verification queue. A verifier sees the photos and the
// system's proposal, records their own decision with a reason, and never sees
// the other verifier's decision.
const outcomeText: Record<string, string> = {
  admit: "The system matched the check-in photo to this candidate. Confirming admits them to the exam.",
  mismatch: "The system matched the check-in photo to a different registered candidate. Confirming opens an identity incident; the exam does not start.",
  no_match: "The system found no registered candidate who matches the check-in photo. Confirming opens an identity incident; the exam does not start.",
};

export function IdentityChecks({ api, session }: { api: AxiosInstance; session: Session }) {
  const org = session.organization.id;
  const matches = useQuery({ queryKey: ["identity-matches"], queryFn: () => api.get(`/api/organizations/${org}/identity-matches`).then((r) => r.data) });
  const verifiers = useQuery({ queryKey: ["identity-verifiers"], queryFn: () => api.get(`/api/organizations/${org}/identity-verifiers`).then((r) => r.data) });
  const [drafts, setDrafts] = useState<Record<string, { decision: string; reason: string }>>({});
  const [message, setMessage] = useState("");
  const [grant, setGrant] = useState({ email: "", trainingCompletedAt: "" });
  const verify = async (id: string) => {
    const draft = drafts[id];
    if (!draft?.decision || !draft.reason?.trim()) return setMessage("Choose confirm or reject and give your reason.");
    try {
      const { data } = await api.post(`/api/organizations/${org}/identity-matches/${id}/verifications`, draft);
      setMessage(data.matchStatus === "pending_verification" ? "Your decision is saved. A second verifier now checks it on their own." : "Both verifications are recorded. The result has been applied.");
      matches.refetch();
    } catch (e) { setMessage(errorText(e, "Your decision was not saved. Try again.")); }
  };
  const authorize = async () => {
    try {
      await api.post(`/api/organizations/${org}/identity-verifiers`, { ...grant, trainingModule: "EG-IDV-1" });
      setGrant({ email: "", trainingCompletedAt: "" }); setMessage("Verifier authorized for 12 months from their training date.");
      verifiers.refetch();
    } catch (e) { setMessage(errorText(e, "The authorization was not saved.")); }
  };
  const revoke = async (id: string) => {
    try { await api.post(`/api/organizations/${org}/identity-verifiers/${id}/revoke`); verifiers.refetch(); }
    catch (e) { setMessage(errorText(e, "The authorization was not revoked.")); }
  };
  const photo = (url: string | undefined, label: string) => <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{url ? <img src={url} alt={label} className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center p-3 text-center text-xs text-slate-500">Photo unavailable</div>}<figcaption className="border-t border-slate-200 px-2 py-1.5 text-center text-xs font-semibold text-slate-600">{label}</figcaption></figure>;
  return <div className="space-y-6">
    <div className="card">
      <p className="eyebrow">Two-person verification</p>
      <h2 className="mt-1 font-semibold">Identity checks</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">A face match only takes effect when two authorized verifiers have each confirmed it. Decide on your own: you will not see the other verifier's decision.</p>
      {message && <p role="status" className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">{message}</p>}
      <div className="mt-5 space-y-4">
        {(matches.data ?? []).length ? matches.data.map((m: any) => <article key={m.id} className="rounded-2xl border border-slate-200 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><b>{m.candidate.name} · {m.exam.title}</b><span className="text-sm text-slate-500">{m.verificationsRecorded} of {m.verificationsRequired} verifications</span></div>
          <p className="mt-2 text-sm text-slate-600">{outcomeText[m.proposedOutcome]}</p>
          <p className="mt-1 text-xs text-slate-500">Similarity {m.similarity ?? "none"} (threshold {m.threshold}) · model {m.modelVersion}</p>
          <div className="mt-4 grid max-w-xl grid-cols-3 gap-3">{photo(m.checkInPhotoUrl, "Check-in photo")}{photo(m.candidate.registeredPhotoUrl, `Registered: ${m.candidate.name}`)}{m.matchedCandidate && photo(m.matchedCandidate.registeredPhotoUrl, `Matched: ${m.matchedCandidate.name}`)}</div>
          {m.youHaveVerified ? <p className="mt-4 text-sm font-medium text-emerald-700">You have verified this match. It needs a different second verifier.</p> : <fieldset className="mt-4 space-y-3 text-sm">
            <legend className="font-medium">Your decision</legend>
            <label className="mr-4"><input type="radio" name={`decision-${m.id}`} onChange={() => setDrafts({ ...drafts, [m.id]: { ...drafts[m.id], decision: "confirm" } })} /> Confirm the system's result</label>
            <label><input type="radio" name={`decision-${m.id}`} onChange={() => setDrafts({ ...drafts, [m.id]: { ...drafts[m.id], decision: "reject" } })} /> Reject it</label>
            <textarea aria-label="Reason for your decision" className="block w-full rounded-lg border border-slate-300 p-2" rows={2} placeholder="What you compared and why you decided this" value={drafts[m.id]?.reason ?? ""} onChange={(e) => setDrafts({ ...drafts, [m.id]: { ...drafts[m.id], reason: e.target.value } })} />
            <button type="button" onClick={() => void verify(m.id)} className="button">Record my verification</button>
          </fieldset>}
        </article>) : <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/40 px-6 py-10 text-center"><ShieldCheck className="mx-auto text-emerald-600" size={28} /><p className="mt-3 font-medium text-slate-800">No identity checks are waiting</p><p className="mt-1 text-sm text-slate-500">New check-ins appear here as candidates arrive.</p></div>}
      </div>
    </div>
    <div className="card">
      <h3 className="font-semibold">Authorized verifiers</h3>
      <p className="mt-1 text-sm text-slate-500">Only proctors and administrators who completed EG-IDV-1 training in the last 12 months, authorized by another administrator, can verify.</p>
      <ul className="mt-4 divide-y text-sm">{(verifiers.data ?? []).map((v: any) => <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{v.user.name} <span className="text-slate-500">· trained {new Date(v.trainingCompletedAt).toLocaleDateString()} · authorized by {v.authorizedBy.name} · {v.revokedAt ? "revoked" : `until ${new Date(v.expiresAt).toLocaleDateString()}`}</span></span>{session.role === "institute_admin" && !v.revokedAt && <button type="button" onClick={() => void revoke(v.id)} className="text-red-700">Revoke</button>}</li>)}</ul>
      {session.role === "institute_admin" && <div className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <label>Proctor email<input type="email" className="mt-1 block rounded-lg border border-slate-300 p-2" value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} /></label>
        <label>EG-IDV-1 completed on<input type="date" className="mt-1 block rounded-lg border border-slate-300 p-2" value={grant.trainingCompletedAt} onChange={(e) => setGrant({ ...grant, trainingCompletedAt: e.target.value })} /></label>
        <button type="button" onClick={() => void authorize()} className="button">Authorize verifier</button>
      </div>}
    </div>
  </div>;
}
