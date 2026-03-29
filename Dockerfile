# Multi-stage build:
# 1) Build the React client
# 2) Run the Node.js API server and serve the built client from Express

FROM node:20-alpine AS client-builder
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app/server

ENV NODE_ENV=production

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/ ./
COPY --from=client-builder /app/client/dist /app/client/dist

# Keep persistent data inside the server working directory by default.
RUN mkdir -p imports books

EXPOSE 5000

CMD ["npm", "start"]
