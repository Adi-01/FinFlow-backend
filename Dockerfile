FROM node:22-bookworm-slim

WORKDIR /app

# Ensure OpenSSL and CA certificates are present for Prisma
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package*.json ./

# Install all dependencies (including devDependencies like tsx, prisma)
RUN npm install

# Copy Prisma configuration and schema to generate the typed client
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Copy source code and configs
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to JavaScript in dist/
RUN npm run build

# Expose Express server port
EXPOSE 5000

# Run migrations and start compiled production server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
