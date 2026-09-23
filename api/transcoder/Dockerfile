# Alpine release and ffmpeg minor version pinned, so a rebuild transcodes the same way; patch releases still apply.
FROM node:24-alpine3.24
RUN apk add --no-cache ffmpeg~=8.1
WORKDIR /app
COPY server.ts .
EXPOSE 8080
CMD ["node", "server.ts"]
