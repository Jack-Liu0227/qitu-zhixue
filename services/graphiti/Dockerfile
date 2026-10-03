FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt bridge.py /app/
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt

ENV GRAPHITI_TELEMETRY_ENABLED=false
EXPOSE 4180
CMD ["python", "bridge.py", "--host", "0.0.0.0", "--port", "4180"]
