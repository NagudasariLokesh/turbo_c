FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends clang \
    && rm -rf /var/lib/apt/lists/*

# Runs student-submitted binaries -- never give this account anything
# beyond executing inside its own temp workspace.
RUN useradd --create-home --shell /usr/sbin/nologin sandboxrunner

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app

USER sandboxrunner

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
