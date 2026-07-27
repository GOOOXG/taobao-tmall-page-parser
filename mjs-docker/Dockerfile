FROM mcr.microsoft.com/playwright:v1.62.0-noble

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PARSER_BROWSER_MODE=managed \
    PARSER_CHROME_PROFILE_DIR=/data/chrome-profile \
    PARSER_HEADLESS=true \
    PARSER_HOST=0.0.0.0 \
    PARSER_PORT=3210

WORKDIR /app

COPY http-api/package.json http-api/package-lock.json ./
RUN npm ci --omit=dev

COPY http-api/api-error.mjs \
     http-api/browser-session.mjs \
     http-api/runtime-config.mjs \
     http-api/server.mjs \
     http-api/taobao-tmall-page-parser.mjs ./

RUN npm run check && \
    mkdir -p /data/chrome-profile && \
    touch /data/chrome-profile/.volume-owner && \
    chown -R pwuser:pwuser /app /data

USER pwuser

EXPOSE 3210

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3210/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
