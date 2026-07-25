# Vanton gateway (+ the agent it spawns for the "Run agent" button).
# Deploy on Railway/Render/Fly; set the env vars from HOSTING.md.
FROM node:20-slim
WORKDIR /app
COPY . .
RUN cd gateway && npm ci && cd ../agent && npm ci
EXPOSE 3402
WORKDIR /app/gateway
CMD ["npx", "tsx", "src/server.ts"]
