FROM python:3.11-slim

# Tesseract + TR/EN dil paketleri (Debian Bullseye deposu ile)
RUN apt-get update && apt-get install -y wget gnupg && \
    echo "deb http://deb.debian.org/debian bullseye main contrib non-free" > /etc/apt/sources.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-tur \
        libtesseract-dev \
        liblept5 \
        libpng16-16 \
        libjpeg62-turbo \
        libtiff5 \
        libglib2.0-0 \
        libsm6 libxext6 libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python bağımlılıkları
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Uygulama kodu
COPY web/ /app/web/

# Ortam değişkenleri
ENV PATH="/usr/bin:$PATH"
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["uvicorn", "web.main:app", "--host", "0.0.0.0", "--port", "8000"]
