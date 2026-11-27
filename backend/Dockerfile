FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0
ENV DB_PATH=/app/data/infradesk.db

COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown -R node:node /app

COPY --from=builder --chown=node:node /app/dist ./dist

USER node
EXPOSE 3333
CMD ["node", "dist/server.js"]
