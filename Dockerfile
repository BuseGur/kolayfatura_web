FROM python:3.11-slim

# Sistem paketleri + Tesseract + Türkçe/İngilizce dilleri
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-tur \
    libjpeg62-turbo-dev \
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

# Ortam değişkenleri
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata
ENV PATH="/usr/bin:$PATH"
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Uygulama başlatma
CMD ["uvicorn", "web.main:app", "--host", "0.0.0.0", "--port", "8000"]
