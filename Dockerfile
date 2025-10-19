FROM python:3.11-bullseye

# Sistem güncelleme + Tesseract ve TR/EN dil paketleri kurulumu
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-tur \
    tesseract-ocr-eng \
    libtesseract-dev \
    libleptonica-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python bağımlılıkları
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Uygulama dosyaları
COPY web/ /app/web/

# Ortam değişkenleri (Tesseract yol ayarı)
ENV PATH="/usr/bin:$PATH"
ENV TESSDATA_PREFIX="/usr/share/tesseract-ocr/4.00/tessdata"
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# FastAPI başlat
CMD ["uvicorn", "web.main:app", "--host", "0.0.0.0", "--port", "8000"]
