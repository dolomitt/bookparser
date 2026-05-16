FROM nvidia/cuda:12.6.3-devel-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      cmake \
      curl \
      git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --recurse-submodules https://github.com/rodrigomatta/s2.cpp.git

WORKDIR /opt/s2.cpp
RUN ln -sf /usr/local/cuda/lib64/stubs/libcuda.so /usr/local/cuda/lib64/stubs/libcuda.so.1 \
    && cmake -B build \
      -DCMAKE_BUILD_TYPE=Release \
      -DS2_CUDA=ON \
      -DCMAKE_CUDA_ARCHITECTURES="75;80;86;89;90" \
      -DCMAKE_EXE_LINKER_FLAGS="-Wl,-rpath-link,/usr/local/cuda/lib64/stubs" \
    && LIBRARY_PATH=/usr/local/cuda/lib64/stubs cmake --build build --parallel "$(nproc)"

RUN mkdir -p /models

COPY docker/s2-pro/entrypoint /usr/local/bin/s2-pro-entrypoint
RUN chmod +x /usr/local/bin/s2-pro-entrypoint

ENV S2_MODEL_PATH=/models/s2-pro-q8_0.gguf \
    S2_TOKENIZER_PATH=/models/tokenizer.json \
    S2_MODEL_URL="https://huggingface.co/rodrigomt/s2-pro-gguf/resolve/main/s2-pro-q8_0.gguf?download=true" \
    S2_TOKENIZER_URL="https://huggingface.co/rodrigomt/s2-pro-gguf/resolve/main/tokenizer.json?download=true" \
    S2_HOST=0.0.0.0 \
    S2_PORT=3030 \
    S2_CUDA_DEVICE=0 \
    S2_THREADS=4 \
    S2_MAX_TOKENS=1024

EXPOSE 3030

ENTRYPOINT ["s2-pro-entrypoint"]
