FROM node:22-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

COPY package*.json ./
# Install dependencies including devDependencies (typescript)
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Compile TypeScript
RUN npm run build

# Remove devDependencies to keep container image lightweight
RUN npm prune --omit=dev

EXPOSE 3000

CMD ["node", "dist/index.js"]
