FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force \
  && mkdir -p /var/lib/wodsiege \
  && chown node:node /var/lib/wodsiege
COPY --chown=node:node server ./server

USER node
EXPOSE 8787
VOLUME ["/var/lib/wodsiege"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)throw Error(r.status)}).catch(()=>process.exit(1))"]
CMD ["node", "server/index.mjs"]
