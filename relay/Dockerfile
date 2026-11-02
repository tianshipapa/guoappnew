FROM node:22-alpine

WORKDIR /app
COPY relay.mjs ./

ENV PORT=8787
EXPOSE 8787

# 无依赖，不需要 npm install
CMD ["node", "relay.mjs"]
