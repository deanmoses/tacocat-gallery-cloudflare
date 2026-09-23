FROM node:24-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY server.ts .
EXPOSE 8080
CMD ["node", "server.ts"]
