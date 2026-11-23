
"""Opt-in single-frame analysis and check-in face identification.

Frames are not persisted by this service. Identification results are
proposals: the ExamGuard API stores them as pending identity matches that two
trained verifiers must confirm before anything happens to a candidate.
"""

import hmac
import os

import numpy as np
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile

app = FastAPI(title="SentinelExam AI service")

MODEL_PATH = os.getenv("YOLO_MODEL_PATH")
# OpenCV Zoo models for check-in identification: YuNet finds and aligns the
# face, SFace turns it into a feature vector that is compared by cosine
# similarity. 0.363 is the SFace authors' recommended cosine threshold.
FACE_DETECTOR_MODEL_PATH = os.getenv("FACE_DETECTOR_MODEL_PATH")
FACE_RECOGNIZER_MODEL_PATH = os.getenv("FACE_RECOGNIZER_MODEL_PATH")
IDENTITY_MATCH_THRESHOLD = float(os.getenv("IDENTITY_MATCH_THRESHOLD", "0.363"))
IDENTITY_MODEL_VERSION = "opencv-yunet-2023mar+sface-2021dec"
MAX_IMAGE_BYTES = 10 * 1024 * 1024

try:
    import cv2
    import mediapipe as mp

    MEDIAPIPE_READY = True
except ImportError:
    cv2 = None
    mp = None
    MEDIAPIPE_READY = False

try:
    from ultralytics import YOLO

    yolo = YOLO(MODEL_PATH) if MODEL_PATH and os.path.isfile(MODEL_PATH) else None
except Exception:
    yolo = None


@app.get("/health")
def health():
    return {
        "mediapipe": "ready" if MEDIAPIPE_READY else "unavailable",
        "phone_model": "ready" if yolo is not None else "unavailable",
        "looking_away": "not_implemented",
        "identity_match": "ready" if identity_models_ready() else "unavailable",
        "note": "Phone detection requires a compatible configured YOLO model."
    }


def identity_models_ready() -> bool:
    return cv2 is not None and all(
        path and os.path.isfile(path)
        for path in (FACE_DETECTOR_MODEL_PATH, FACE_RECOGNIZER_MODEL_PATH)
    )


def require_service_token(authorization: str | None = Header(default=None)):
    """Only the ExamGuard API, holding AI_SERVICE_TOKEN, may call /identify."""
    token = os.getenv("AI_SERVICE_TOKEN")
    if not token or not authorization or not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(401, "A valid service credential is required")


async def read_image(upload: UploadFile):
    if upload.content_type and not upload.content_type.startswith("image/"):
        raise HTTPException(415, "Upload an image file")
    content = await upload.read()
    if not content:
        raise HTTPException(400, "Uploaded image is empty")
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds the 10 MB limit")
    image = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "Invalid image")
    return image


def faces_in(image):
    height, width = image.shape[:2]
    detector = cv2.FaceDetectorYN.create(FACE_DETECTOR_MODEL_PATH, "", (width, height), 0.8)
    _, faces = detector.detect(image)
    return [] if faces is None else list(faces)


@app.post("/identify", dependencies=[Depends(require_service_token)])
async def identify(probe: UploadFile = File(...), references: list[UploadFile] = File(...)):
    """Compare the face in a check-in photo with registered candidate photos.

    Each reference upload's filename is the candidate ID it belongs to. The
    answer names the most similar reference and its cosine similarity. It is
    a proposal only: this service creates no record and takes no action.
    """
    if not identity_models_ready():
        raise HTTPException(503, "Identity models are not configured")

    probe_image = await read_image(probe)
    probe_faces = faces_in(probe_image)
    result = {
        "face_count": len(probe_faces),
        "best_match": None,
        "threshold": IDENTITY_MATCH_THRESHOLD,
        "model_version": IDENTITY_MODEL_VERSION,
    }
    if len(probe_faces) != 1:
        return result

    recognizer = cv2.FaceRecognizerSF.create(FACE_RECOGNIZER_MODEL_PATH, "")
    probe_feature = recognizer.feature(recognizer.alignCrop(probe_image, probe_faces[0]))
    for reference in references:
        image = await read_image(reference)
        faces = faces_in(image)
        if len(faces) != 1:
            # A registered photo without exactly one face cannot be compared.
            continue
        feature = recognizer.feature(recognizer.alignCrop(image, faces[0]))
        similarity = float(recognizer.match(probe_feature, feature, cv2.FaceRecognizerSF_FR_COSINE))
        if result["best_match"] is None or similarity > result["best_match"]["similarity"]:
            result["best_match"] = {"reference_id": reference.filename, "similarity": round(similarity, 4)}
    return result


@app.post("/analyze")
async def analyze(frame: UploadFile):
    if not MEDIAPIPE_READY:
        raise HTTPException(503, "OpenCV or MediaPipe is unavailable")

    if frame.content_type and not frame.content_type.startswith("image/"):
        raise HTTPException(415, "Upload an image file")

    content = await frame.read()

    if not content:
        raise HTTPException(400, "Uploaded image is empty")

    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image exceeds the 10 MB limit")

    image = cv2.imdecode(
        np.frombuffer(content, dtype=np.uint8),
        cv2.IMREAD_COLOR
    )

    if image is None:
        raise HTTPException(400, "Invalid image")

    # Actual MediaPipe face detection on this frame.
    with mp.solutions.face_detection.FaceDetection(
        model_selection=0,
        min_detection_confidence=0.5
    ) as detector:
        result = detector.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

    face_count = len(result.detections or [])

    # Run actual YOLO inference only when a model is configured.
    phone_detection = "unavailable"
    phone_confidence = None

    if yolo is not None:
        try:
            predictions = yolo.predict(
                source=image,
                conf=0.35,
                verbose=False
            )
        except Exception as exc:
            # A failed optional model must never be represented as a signal.
            # The caller can retain the frame locally or retry with a healthy
            # model; this service does not create incidents or take action.
            raise HTTPException(503, "Phone-detection model inference is unavailable") from exc

        names = predictions[0].names
        boxes = predictions[0].boxes
        phone_scores = []

        if boxes is not None:
            for box in boxes:
                class_id = int(box.cls.item())
                class_name = str(names[class_id]).lower().replace("_", " ")

                # Match common phone labels; custom model labels may differ.
                if any(label in class_name for label in (
                    "cell phone", "cellphone", "mobile phone",
                    "mobile", "smartphone", "smart phone"
                )):
                    phone_scores.append(float(box.conf.item()))

        phone_detection = "detected" if phone_scores else "not_detected"

        if phone_scores:
            phone_confidence = round(max(phone_scores), 3)

    return {
        "face_presence": face_count > 0,
        "face_count": face_count,
        "multiple_faces": face_count > 1,
        "looking_away": "not_implemented",
        "phone_detection": phone_detection,
        "phone_confidence": phone_confidence,
        "disclosure": (
            "One uploaded frame was processed in memory. "
            "This endpoint does not save images or create incidents."
        )
    }
