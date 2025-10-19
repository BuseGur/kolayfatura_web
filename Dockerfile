FROM python:3.11-slim

# Tesseract + TR/EN dil paketleri (Render uyumlu)
RUN apt-get update && apt-get install -y --no-install-recommends \
    apt-utils \
    lsb-release \
    gnupg \
    wget \
 && echo "deb http://deb.debian.org/debian bookworm main contrib non-free" > /etc/apt/sources.list \
 && apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-tur \
    libtesseract-dev \
    libpng-dev \
    libjpeg62-turbo-dev \
    libtiff-dev \
    libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python bağımlılıkları
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Uygulama kodu
COPY web/ /app/web/

# Tesseract yol ayarları
ENV PATH="/usr/bin:$PATH"
ENV TESSDATA_PREFIX="/usr/share/tesseract-ocr/4.00/tessdata"
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["uvicorn", "web.main:app", "--host", "0.0.0.0", "--port", "8000"]
