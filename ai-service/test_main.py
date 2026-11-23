import asyncio
import os
import importlib.util
from io import BytesIO
from pathlib import Path
import unittest

from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers


spec = importlib.util.spec_from_file_location("examguard_ai_main", Path(__file__).with_name("main.py"))
assert spec and spec.loader
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


def upload(content: bytes, content_type: str = "image/jpeg") -> UploadFile:
    return UploadFile(filename="frame.jpg", file=BytesIO(content), headers=Headers({"content-type": content_type}))


class FakeCv2:
    IMREAD_COLOR = 1
    COLOR_BGR2RGB = 2

    @staticmethod
    def imdecode(content, _mode):
        return object() if content.tobytes() == b"valid-image" else None

    @staticmethod
    def cvtColor(image, _mode):
        return image


class FakeDetector:
    def __init__(self, *_args, **_kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    @staticmethod
    def process(_image):
        return type("Result", (), {"detections": [object(), object()]})()


class FakeMediaPipe:
    class solutions:
        class face_detection:
            FaceDetection = FakeDetector


class FailingModel:
    def predict(self, **_kwargs):
        raise RuntimeError("model process failed")


class AnalyzeTests(unittest.TestCase):
    def setUp(self):
        self.original = service.MEDIAPIPE_READY, service.cv2, service.mp, service.yolo
        service.MEDIAPIPE_READY = True
        service.cv2 = FakeCv2
        service.mp = FakeMediaPipe
        service.yolo = None

    def tearDown(self):
        service.MEDIAPIPE_READY, service.cv2, service.mp, service.yolo = self.original

    def test_health_reports_optional_model_unavailable(self):
        health = service.health()
        self.assertEqual(health["phone_model"], "unavailable")
        self.assertEqual(health["looking_away"], "not_implemented")

    def test_valid_image_is_processed_without_creating_an_action(self):
        result = asyncio.run(service.analyze(upload(b"valid-image")))
        self.assertTrue(result["face_presence"])
        self.assertEqual(result["face_count"], 2)
        self.assertTrue(result["multiple_faces"])
        self.assertEqual(result["phone_detection"], "unavailable")
        self.assertEqual(result["looking_away"], "not_implemented")
        self.assertIn("does not save images or create incidents", result["disclosure"])

    def test_rejects_non_image_and_empty_uploads(self):
        with self.assertRaises(HTTPException) as non_image:
            asyncio.run(service.analyze(upload(b"valid-image", "application/pdf")))
        self.assertEqual(non_image.exception.status_code, 415)
        with self.assertRaises(HTTPException) as empty:
            asyncio.run(service.analyze(upload(b"")))
        self.assertEqual(empty.exception.status_code, 400)

    def test_reports_cv_stack_unavailable_before_processing(self):
        service.MEDIAPIPE_READY = False
        with self.assertRaises(HTTPException) as unavailable:
            asyncio.run(service.analyze(upload(b"valid-image")))
        self.assertEqual(unavailable.exception.status_code, 503)

    def test_reports_model_inference_failure_without_returning_a_signal(self):
        service.yolo = FailingModel()
        with self.assertRaises(HTTPException) as unavailable:
            asyncio.run(service.analyze(upload(b"valid-image")))
        self.assertEqual(unavailable.exception.status_code, 503)
        self.assertEqual(unavailable.exception.detail, "Phone-detection model inference is unavailable")



class FakeImage:
    shape = (480, 640, 3)

    def __init__(self, name):
        self.name = name


class FakeIdentityCv2:
    IMREAD_COLOR = 1
    FaceRecognizerSF_FR_COSINE = 0
    faces = {"probe": 1, "same-person": 1, "other-person": 1, "group": 2}
    scores = {"same-person": 0.71, "other-person": 0.12}

    @staticmethod
    def imdecode(content, _mode):
        return FakeImage(content.tobytes().decode())

    class FaceDetectorYN:
        @staticmethod
        def create(*_args):
            class Detector:
                def detect(self, image):
                    count = FakeIdentityCv2.faces.get(image.name, 0)
                    return None, [image.name] * count if count else None
            return Detector()

    class FaceRecognizerSF:
        @staticmethod
        def create(*_args):
            class Recognizer:
                def alignCrop(self, _image, face):
                    return face

                def feature(self, crop):
                    return crop

                def match(self, _probe, reference, _mode):
                    return FakeIdentityCv2.scores[reference]
            return Recognizer()


def named_upload(content: bytes, filename: str) -> UploadFile:
    return UploadFile(filename=filename, file=BytesIO(content), headers=Headers({"content-type": "image/jpeg"}))


class IdentifyTests(unittest.TestCase):
    def setUp(self):
        self.original = service.cv2, service.identity_models_ready
        service.cv2 = FakeIdentityCv2
        service.identity_models_ready = lambda: True

    def tearDown(self):
        service.cv2, service.identity_models_ready = self.original

    def test_returns_the_most_similar_reference_as_a_proposal(self):
        result = asyncio.run(service.identify(named_upload(b"probe", "check-in.jpg"), [
            named_upload(b"other-person", "11111111-1111-4111-8111-111111111111"),
            named_upload(b"same-person", "22222222-2222-4222-8222-222222222222"),
        ]))
        self.assertEqual(result["face_count"], 1)
        self.assertEqual(result["best_match"], {"reference_id": "22222222-2222-4222-8222-222222222222", "similarity": 0.71})
        self.assertEqual(result["model_version"], service.IDENTITY_MODEL_VERSION)

    def test_no_identification_without_exactly_one_face(self):
        result = asyncio.run(service.identify(named_upload(b"group", "check-in.jpg"), [named_upload(b"same-person", "22222222-2222-4222-8222-222222222222")]))
        self.assertEqual(result["face_count"], 2)
        self.assertIsNone(result["best_match"])

    def test_identify_requires_the_service_credential(self):
        os.environ["AI_SERVICE_TOKEN"] = "test-service-token"
        try:
            with self.assertRaises(HTTPException) as missing:
                service.require_service_token(None)
            self.assertEqual(missing.exception.status_code, 401)
            with self.assertRaises(HTTPException) as wrong:
                service.require_service_token("Bearer wrong")
            self.assertEqual(wrong.exception.status_code, 401)
            service.require_service_token("Bearer test-service-token")
        finally:
            del os.environ["AI_SERVICE_TOKEN"]
