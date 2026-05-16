FROM qwenllm/qwen3-asr:latest

WORKDIR /app

COPY docker/qwen-aligner/server.py /app/server.py

ENV HF_HOME=/models/huggingface \
    TRANSFORMERS_CACHE=/models/huggingface \
    QWEN_ALIGNER_MODEL=Qwen/Qwen3-ForcedAligner-0.6B \
    QWEN_ALIGNER_LANGUAGE=Japanese \
    QWEN_ALIGNER_DTYPE=bfloat16 \
    QWEN_ALIGNER_DEVICE=cuda:0 \
    QWEN_ALIGNER_HOST=0.0.0.0 \
    QWEN_ALIGNER_PORT=8050

EXPOSE 8050

CMD ["python", "/app/server.py"]
