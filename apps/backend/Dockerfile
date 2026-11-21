FROM node:20-alpine

WORKDIR /app

# Install openssl (required by Prisma on Alpine) and curl (for docker health check)
RUN apk add --no-cache openssl curl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

# Generate Prisma client and compile TypeScript
RUN npx prisma generate
RUN npm run build

EXPOSE 5000

CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/index.js"]
