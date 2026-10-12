FROM node:22-bookworm-slim

WORKDIR /app

# Ensure OpenSSL and CA certificates are present for Prisma
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package*.json ./

# Install all dependencies (including devDependencies like tsx, prisma)
RUN npm install

# Copy configuration, schema, and source files
# Note: tsconfig.json MUST be present before `prisma generate` so Prisma ORM 7 detects moduleResolution: NodeNext and generates valid .js ESM imports
COPY tsconfig.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma Client with NodeNext ESM module resolution
RUN npx prisma generate

# Compile TypeScript to JavaScript in dist/
RUN npm run build

# Expose Express server port
EXPOSE 5000

# Run migrations and start compiled production server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
