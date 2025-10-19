# Dockerfile (repo kökünde)
FROM python:3.11-slim

# Tesseract + TR/EN dil paketleri
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-tur \
    libjpeg62-turbo libpng16-16 libtiff5 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python bağımlılıkları
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Uygulama kodu
COPY web/ /app/web/

# Tesseract data yolu (Linux’ta standart)
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata
ENV PYTHONUNBUFFERED=1

# Render, rastgele bir $PORT atar — buna dinle
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn web.main:app --host 0.0.0.0 --port ${PORT}"]
