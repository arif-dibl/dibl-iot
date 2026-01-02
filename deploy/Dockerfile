FROM python:3.9-slim

WORKDIR /app

# Copy requirements
COPY src/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and resources
COPY src/ /app/src/
COPY config/ /app/config/
COPY data/ /app/data/

# Set working directory to source
WORKDIR /app/src

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]
