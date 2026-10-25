FROM node:22-slim

WORKDIR /app

# Install native build tools for better-sqlite3 compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Install dependencies including devDependencies (typescript)
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Compile TypeScript
RUN npm run build

# Remove devDependencies to keep container image lightweight
RUN npm prune --omit=dev \
 && mkdir -p /app/data/digests \
 && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
