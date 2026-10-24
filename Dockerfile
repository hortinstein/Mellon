# syntax=docker/dockerfile:1
# Mellon: one Node process, no runtime dependencies, state in one JSON file on /data.
FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY scripts/admin.js scripts/docker-start.js ./scripts/

ENV NODE_ENV=production \
    PORT=8080 \
    MELLON_DATA=/data/mellon.json \
    MELLON_RUN_AS_UID=1000 \
    MELLON_RUN_AS_GID=1000

RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Starts as root only long enough to chown the mounted volume, then runs as "node".
CMD ["node", "scripts/docker-start.js"]
