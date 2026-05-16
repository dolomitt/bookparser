import base64
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from qwen_asr import Qwen3ForcedAligner


MODEL_ID = os.environ.get("QWEN_ALIGNER_MODEL", "Qwen/Qwen3-ForcedAligner-0.6B")
LANGUAGE = os.environ.get("QWEN_ALIGNER_LANGUAGE", "Japanese")
DTYPE = os.environ.get("QWEN_ALIGNER_DTYPE", "bfloat16").lower()
DEVICE = os.environ.get("QWEN_ALIGNER_DEVICE", "cuda:0")
HOST = os.environ.get("QWEN_ALIGNER_HOST", "0.0.0.0")
PORT = int(os.environ.get("QWEN_ALIGNER_PORT", "8050"))


def torch_dtype():
    if DTYPE in ("bf16", "bfloat16"):
        return torch.bfloat16
    if DTYPE in ("fp16", "float16", "half"):
        return torch.float16
    return torch.float32


print(f"Loading Qwen forced aligner {MODEL_ID} on {DEVICE} ({DTYPE})", flush=True)
model = Qwen3ForcedAligner.from_pretrained(
    MODEL_ID,
    dtype=torch_dtype(),
    device_map=DEVICE,
)
print("Qwen forced aligner ready", flush=True)


def item_to_dict(item):
    if isinstance(item, dict):
        text = item.get("text", "")
        start_time = item.get("start_time", item.get("startTime"))
        end_time = item.get("end_time", item.get("endTime"))
    else:
        text = getattr(item, "text", "")
        start_time = getattr(item, "start_time", getattr(item, "startTime", None))
        end_time = getattr(item, "end_time", getattr(item, "endTime", None))

    if start_time is None or end_time is None:
        return None

    return {
        "text": str(text or ""),
        "startTime": float(start_time),
        "endTime": float(end_time),
    }


def items_to_dicts(items):
    return [converted for converted in (item_to_dict(item) for item in items) if converted]


def flatten_alignment(result):
    if not result:
        return []

    first = result[0]
    if isinstance(first, dict):
        return items_to_dicts(result)

    if isinstance(first, (list, tuple)):
        return items_to_dicts(first)

    nested_items = getattr(first, "items", None)
    if nested_items is not None and not callable(nested_items):
        return items_to_dicts(nested_items)

    return items_to_dicts(result)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True, "model": MODEL_ID})
            return

        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/align":
            self.send_json(404, {"error": "not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            audio_b64 = payload.get("audio")
            text = payload.get("text")
            language = payload.get("language") or LANGUAGE

            if not audio_b64 or not text:
                self.send_json(400, {"error": "audio and text are required"})
                return

            audio_bytes = base64.b64decode(audio_b64)
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as audio_file:
                audio_file.write(audio_bytes)
                audio_path = audio_file.name

            try:
                result = model.align(
                    audio=audio_path,
                    text=text,
                    language=language,
                )
                self.send_json(200, {"segments": flatten_alignment(result)})
            finally:
                os.remove(audio_path)
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})


ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
