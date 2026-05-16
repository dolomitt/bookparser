# S2 Pro Docker

This service builds `s2.cpp` with CUDA and serves `rodrigomt/s2-pro-gguf` using the `s2-pro-q8_0.gguf` model.

Prefer a prebuilt image if you have access to one:

```powershell
docker compose -f docker-compose.s2-pro.yml --profile prebuilt up
```

Equivalent direct Docker command:

```powershell
docker run --rm -it --gpus all -p 3030:3030 -v "${PWD}/models/s2-pro:/models" fishaudio/s2-cpp-server:latest
```

If the prebuilt image is not available, build `s2.cpp` locally:

```powershell
docker compose -f docker-compose.s2-pro.yml --profile build up --build
```

The first startup downloads about 5.6 GB into the host-mounted Docker volume at `models/s2-pro`, which is git-ignored. Rebuilding the image does not delete or redownload the model as long as that folder stays in place. The app talks to it at `http://127.0.0.1:3030/generate` through `BOOKPARSER_TTS_PROVIDER=s2-pro`.

S2 Pro voice cloning does not use Fish Speech `reference_id`. To clone a voice, set both `S2_PRO_REFERENCE_AUDIO_PATH` and `S2_PRO_REFERENCE_TEXT` for the Node server.

The same Compose file also keeps the MFA aligner running as `practical_hypatia` for `MFA_RUNTIME=docker`. Its downloaded Japanese models live in `models/mfa/pretrained_models`, mounted at `/mfa/pretrained_models`.
