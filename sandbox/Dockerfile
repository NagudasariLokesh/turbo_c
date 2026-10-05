FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends clang gdb \
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
# Render (and most PaaS Docker hosts) inject a PORT env var and require the
# container to bind to it -- exec-form CMD can't expand env vars, so this
# needs shell form. Falls back to 8000 for plain `docker run` locally.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
