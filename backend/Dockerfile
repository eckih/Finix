# Backend: FastAPI + Abfrage-Skripte (USA_Kontostand, persist)
# Läuft aus Projektroot, damit Imports funktionieren
FROM python:3.11-slim

WORKDIR /app

# Projektroot-Inhalte (Backend braucht USA_Kontostand, persist, data-Verzeichnis)
COPY requirements.txt .
COPY backend/requirements.txt backend/
RUN pip install --no-cache-dir -r requirements.txt -r backend/requirements.txt

COPY USA_Kontostand.py persist.py ./
COPY backend/ ./backend/
RUN mkdir -p data

ENV PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
