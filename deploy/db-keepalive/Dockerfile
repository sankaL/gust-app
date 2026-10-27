FROM alpine:3.20

RUN apk add --no-cache postgresql16-client

WORKDIR /app
COPY --chmod=755 run.sh ./run.sh
CMD ["./run.sh"]
