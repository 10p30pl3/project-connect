FROM python:3.11-slim

WORKDIR /app

# Instala dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pré-download do modelo Faster-Whisper Small em tempo de build para acelerar o boot do container
ENV WHISPER_MODEL_SIZE=small
ENV WHISPER_DEVICE=auto
ENV WHISPER_COMPUTE_TYPE=auto

RUN python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"

COPY . .

# Modelos ONNX de biometria vocal (campplus.onnx, ecapa512.onnx) são montados em /app/models (ver docker-compose.yml)
# Baixe-os com: ./scripts/download_models.sh
ENV MODELS_DIR=/app/models

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
