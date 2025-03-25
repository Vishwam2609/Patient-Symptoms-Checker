# Use a public Python slim image as the base
FROM python:3.10-slim

# Install system packages, including Node.js and procps for 'ps'
RUN apt-get update && \
    apt-get install -y curl gnupg build-essential procps && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the Node.js package files and install frontend dependencies
COPY package*.json ./
RUN npm install

# Copy the Python requirements (assuming they're in src/requirements.txt) and install them
COPY src/requirements.txt ./src/
RUN pip install --upgrade pip && pip install -r src/requirements.txt

# Install lightning-app (if not already included in requirements.txt)
RUN pip install lightning-app

# Copy the rest of the project files into the container
COPY . .

# Expose the port used by the frontend (assuming 5173)
EXPOSE 5173

# Command to run the Lightning App (which starts the frontend server)
CMD ["python", "src/app.py"]